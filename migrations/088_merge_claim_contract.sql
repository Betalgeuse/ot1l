BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:merge-claim-contract:088',0));

-- Return the stored approval scope to the runner that enforces it before merge.
CREATE OR REPLACE FUNCTION otl.bug_runner_claim_merge(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE change otl.git_changes; r otl.bug_reports; run otl.agent_runs;
  at_time timestamptz:=coalesce((p->>'now')::timestamptz,clock_timestamp());
BEGIN
  IF coalesce(p->>'teamId','')='' OR coalesce(p->>'workerId','')='' OR coalesce(p->>'leaseToken','')=''
  THEN RAISE EXCEPTION 'invalid merge claim' USING ERRCODE='22023'; END IF;
  UPDATE otl.git_changes SET merge_status=CASE WHEN merge_attempt>=3 THEN 'failed' ELSE 'approved' END,
    merge_worker_id=NULL,merge_lease_token=NULL,merge_lease_expires_at=NULL,
    merge_retry_after=CASE WHEN merge_attempt>=3 THEN NULL ELSE at_time END
  WHERE merge_status='claimed' AND merge_lease_expires_at<at_time;
  SELECT changes.* INTO change FROM otl.git_changes changes
  JOIN otl.bug_reports reports ON reports.bug_id=changes.bug_id
  WHERE reports.team_id=p->>'teamId' AND reports.state='merge_eligible'
    AND changes.merge_status='approved' AND coalesce(changes.merge_retry_after,at_time)<=at_time
  ORDER BY changes.approved_at,changes.change_id FOR UPDATE OF changes SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN 'null'::jsonb; END IF;
  UPDATE otl.git_changes SET merge_status='claimed',merge_attempt=merge_attempt+1,
    merge_worker_id=p->>'workerId',merge_lease_token=p->>'leaseToken',
    merge_lease_expires_at=at_time+interval '5 minutes'
  WHERE change_id=change.change_id RETURNING * INTO change;
  SELECT * INTO r FROM otl.bug_reports WHERE bug_id=change.bug_id;
  SELECT * INTO run FROM otl.agent_runs WHERE bug_id=r.bug_id AND exit_class='checks_green'
    ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'merge run missing' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('changeId',change.change_id,'bugId',r.bug_id,'prNumber',change.pr_number,
    'headSha',change.commit_sha,'runId',run.run_id,'leaseToken',change.merge_lease_token,
    'attempt',change.merge_attempt,'changeClass',change.change_class,
    'changedPaths',change.changed_paths,'classificationDigest',change.classification_digest);
END $$;

REVOKE ALL ON FUNCTION otl.bug_runner_claim_merge(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION otl.bug_runner_claim_merge(jsonb) TO otl_bug_runner;
CREATE OR REPLACE FUNCTION otl.bug_runner_fail_merge(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE change otl.git_changes; at_time timestamptz:=coalesce((p->>'now')::timestamptz,clock_timestamp());
BEGIN
  UPDATE otl.git_changes SET merge_status=CASE WHEN merge_attempt>=3 THEN 'failed' ELSE 'approved' END,
    merge_retry_after=CASE WHEN merge_attempt>=3 THEN NULL ELSE at_time+interval '60 seconds' END,
    merge_worker_id=NULL,merge_lease_token=NULL,merge_lease_expires_at=NULL
  WHERE change_id=(p->>'changeId')::bigint AND merge_status='claimed'
    AND merge_worker_id=p->>'workerId' AND merge_lease_token=p->>'leaseToken'
  RETURNING * INTO change;
  IF NOT FOUND THEN RAISE EXCEPTION 'merge lease lost' USING ERRCODE='40001'; END IF;
  IF change.merge_status='failed' THEN
    INSERT INTO otl.bug_runner_notifications(team_id,bug_id,job_id,run_id,channel_id,thread_ts,kind,payload)
    SELECT r.team_id,r.bug_id,a.job_id,a.run_id,r.source_channel_id,r.source_thread,'task_failed',
      jsonb_build_object('attempt',change.merge_attempt,'reporterId',r.reporter_id,'adminId',change.approved_by,
        'prNumber',change.pr_number,'prUrl','https://github.com/Betalgeuse/ot1l/pull/'||change.pr_number,
        'summary','승인은 기록됐지만 자동 병합에 실패했어요. 승인 버튼을 다시 누를 필요는 없습니다. PO 작업에서 PR 상태와 검증 결과를 확인해 주세요.')
    FROM otl.bug_reports r JOIN LATERAL (
      SELECT * FROM otl.agent_runs WHERE bug_id=r.bug_id AND exit_class='checks_green' ORDER BY created_at DESC LIMIT 1
    ) a ON true WHERE r.bug_id=change.bug_id AND r.team_id=p->>'teamId'
    ON CONFLICT(run_id,kind) DO NOTHING;
  END IF;
  RETURN to_jsonb(change);
END $$;
INSERT INTO otl.schema_migrations(version) VALUES('088-merge-claim-contract');
COMMIT;
