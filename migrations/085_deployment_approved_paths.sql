BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:deployment-approved-paths:085',0));

CREATE OR REPLACE FUNCTION otl.bug_runner_claim_deployment(p jsonb) RETURNS jsonb
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
    'attempt',change.deployment_attempt,'leaseToken',change.deployment_lease_token,
    'changedPaths',change.changed_paths,'classificationDigest',change.classification_digest);
END $$;

REVOKE ALL ON FUNCTION otl.bug_runner_claim_deployment(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION otl.bug_runner_claim_deployment(jsonb) TO otl_bug_runner;

INSERT INTO otl.schema_migrations(version) VALUES('085-deployment-approved-paths');
COMMIT;
