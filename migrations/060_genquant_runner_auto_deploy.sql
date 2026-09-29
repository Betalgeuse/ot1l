BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:genquant-runner-auto-deploy:060',0));

ALTER TABLE otl.git_changes
  ADD COLUMN deployment_status text NOT NULL DEFAULT 'manual_required',
  ADD COLUMN deployment_attempt smallint NOT NULL DEFAULT 0,
  ADD COLUMN deployment_worker_id text,
  ADD COLUMN deployment_lease_token text,
  ADD COLUMN deployment_lease_expires_at timestamptz,
  ADD COLUMN deployment_retry_after timestamptz,
  ADD COLUMN deployment_last_error_code text;
UPDATE otl.git_changes SET deployment_status=CASE WHEN deploy_version IS NULL THEN 'manual_required' ELSE 'deployed' END;
ALTER TABLE otl.git_changes ALTER COLUMN deployment_status SET DEFAULT 'pending';
ALTER TABLE otl.git_changes
  ADD CONSTRAINT git_changes_deployment_status_check
    CHECK(deployment_status IN ('pending','claimed','failed','deployed','manual_required')),
  ADD CONSTRAINT git_changes_deployment_attempt_check CHECK(deployment_attempt BETWEEN 0 AND 3),
  ADD CONSTRAINT git_changes_deployment_claim_check CHECK(
    (deployment_status='claimed')=(deployment_worker_id IS NOT NULL AND deployment_lease_token IS NOT NULL AND deployment_lease_expires_at IS NOT NULL)
  );

ALTER TABLE otl.bug_runner_notifications DROP CONSTRAINT bug_runner_notifications_kind_check;
ALTER TABLE otl.bug_runner_notifications ADD CONSTRAINT bug_runner_notifications_kind_check
  CHECK(kind IN ('task_started','task_ready','task_failed','merge_ready','change_merged','change_deployed','deployment_manual'));

CREATE FUNCTION otl.bug_runner_claim_deployment(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE change otl.git_changes; report otl.bug_reports; run otl.agent_runs;
  at_time timestamptz:=coalesce((p->>'now')::timestamptz,clock_timestamp());
BEGIN
  IF coalesce(p->>'teamId','')='' OR coalesce(p->>'workerId','')='' OR coalesce(p->>'leaseToken','')=''
  THEN RAISE EXCEPTION 'invalid deployment claim' USING ERRCODE='22023'; END IF;
  UPDATE otl.git_changes SET deployment_status=CASE WHEN deployment_attempt>=3 THEN 'manual_required' ELSE 'failed' END,
    deployment_worker_id=NULL,deployment_lease_token=NULL,deployment_lease_expires_at=NULL,
    deployment_retry_after=CASE WHEN deployment_attempt>=3 THEN NULL ELSE at_time END,
    deployment_last_error_code=coalesce(deployment_last_error_code,'lease_expired')
  WHERE deployment_status='claimed' AND deployment_lease_expires_at<at_time;
  SELECT changes.* INTO change FROM otl.git_changes changes
    JOIN otl.bug_reports reports USING(bug_id)
  WHERE reports.team_id=p->>'teamId' AND reports.state='merged'
    AND changes.merge_status='merged' AND changes.merged_sha IS NOT NULL
    AND changes.deploy_version IS NULL AND changes.deployment_attempt<3
    AND changes.deployment_status IN ('pending','failed')
    AND coalesce(changes.deployment_retry_after,at_time)<=at_time
    AND NOT EXISTS(SELECT 1 FROM otl.bug_jobs jobs JOIN otl.bug_reports active_reports USING(bug_id)
      WHERE active_reports.team_id=reports.team_id AND jobs.status='leased')
  ORDER BY changes.approved_at,changes.change_id FOR UPDATE OF changes SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN 'null'::jsonb; END IF;
  UPDATE otl.git_changes SET deployment_status='claimed',deployment_attempt=deployment_attempt+1,
    deployment_worker_id=p->>'workerId',deployment_lease_token=p->>'leaseToken',
    deployment_lease_expires_at=at_time+interval '10 minutes',deployment_retry_after=NULL,
    deployment_last_error_code=NULL
  WHERE change_id=change.change_id RETURNING * INTO change;
  SELECT * INTO report FROM otl.bug_reports WHERE bug_id=change.bug_id;
  SELECT * INTO run FROM otl.agent_runs WHERE bug_id=change.bug_id AND exit_class='checks_green'
    ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'deployment run missing' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('changeId',change.change_id,'bugId',report.bug_id,
    'mergeSha',change.merged_sha,'approvedBy',change.approved_by,'publicAlias',report.public_alias,
    'jobId',run.job_id,'runId',run.run_id,'taskUrl',run.provider_task_url,
    'attempt',change.deployment_attempt,'leaseToken',change.deployment_lease_token);
END $$;

CREATE FUNCTION otl.bug_runner_finish_deployment(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE change otl.git_changes; result jsonb;
BEGIN
  SELECT * INTO change FROM otl.git_changes WHERE change_id=(p->>'changeId')::bigint FOR UPDATE;
  IF NOT FOUND OR change.deployment_status<>'claimed' OR change.deployment_worker_id<>p->>'workerId'
    OR change.deployment_lease_token<>p->>'leaseToken' OR change.merged_sha<>p->>'mergeSha'
  THEN RAISE EXCEPTION 'deployment lease lost' USING ERRCODE='40001'; END IF;
  result:=otl.bug_record_verified_deployment(p);
  UPDATE otl.git_changes SET deployment_status='deployed',deployment_worker_id=NULL,
    deployment_lease_token=NULL,deployment_lease_expires_at=NULL,deployment_retry_after=NULL,
    deployment_last_error_code=NULL WHERE change_id=change.change_id;
  RETURN result;
END $$;

CREATE FUNCTION otl.bug_runner_fail_deployment(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE change otl.git_changes; at_time timestamptz:=coalesce((p->>'now')::timestamptz,clock_timestamp()); manual boolean:=coalesce((p->>'manualRequired')::boolean,false);
BEGIN
  UPDATE otl.git_changes SET deployment_status=CASE WHEN manual OR deployment_attempt>=3 THEN 'manual_required' ELSE 'failed' END,
    deployment_retry_after=CASE WHEN manual OR deployment_attempt>=3 THEN NULL ELSE at_time+interval '60 seconds' END,
    deployment_last_error_code=left(coalesce(p->>'errorCode','deployment_failed'),120),
    deployment_worker_id=NULL,deployment_lease_token=NULL,deployment_lease_expires_at=NULL
  WHERE change_id=(p->>'changeId')::bigint AND deployment_status='claimed'
    AND deployment_worker_id=p->>'workerId' AND deployment_lease_token=p->>'leaseToken'
  RETURNING * INTO change;
  IF NOT FOUND THEN RAISE EXCEPTION 'deployment lease lost' USING ERRCODE='40001'; END IF;
  IF change.deployment_status='manual_required' THEN
    INSERT INTO otl.bug_runner_notifications(team_id,bug_id,job_id,run_id,channel_id,thread_ts,kind,payload)
    SELECT reports.team_id,reports.bug_id,runs.job_id,runs.run_id,reports.source_channel_id,reports.source_thread,
      'deployment_manual',jsonb_build_object('taskUrl',runs.provider_task_url,'attempt',change.deployment_attempt,
        'reporterId',reports.reporter_id,'adminId',change.approved_by,
        'summary','자동 배포 범위 밖의 변경이 포함되어 운영자 배포가 필요합니다.')
    FROM otl.bug_reports reports JOIN LATERAL(
      SELECT * FROM otl.agent_runs WHERE bug_id=reports.bug_id AND exit_class='checks_green' ORDER BY created_at DESC LIMIT 1
    ) runs ON true WHERE reports.bug_id=change.bug_id
    ON CONFLICT(run_id,kind) DO NOTHING;
  END IF;
  RETURN to_jsonb(change);
END $$;

REVOKE ALL ON FUNCTION otl.bug_runner_claim_deployment(jsonb),otl.bug_runner_finish_deployment(jsonb),otl.bug_runner_fail_deployment(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION otl.bug_runner_claim_deployment(jsonb),otl.bug_runner_finish_deployment(jsonb),otl.bug_runner_fail_deployment(jsonb) TO otl_bug_runner;

INSERT INTO otl.schema_migrations(version) VALUES('060-genquant-runner-auto-deploy');
COMMIT;
