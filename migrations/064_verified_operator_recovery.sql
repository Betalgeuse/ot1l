BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:verified-operator-recovery:064',0));

INSERT INTO otl.bug_transition_contract(
  from_state,to_state,variant,actor_requirements,guard_code,required_guard_keys,
  required_evidence_keys,side_effect,resume_state
) VALUES
  ('fixing','resolved','verified_operator_recovery','[["admin","deployer"]]',
    'operator_recovery',ARRAY['mergedOnMain','deployed','scenarioPass'],
    ARRAY['commitSha','workerVersion','checkReceipt','prNumber'],'notice',NULL),
  ('fix_failed','resolved','verified_operator_recovery','[["admin","deployer"]]',
    'operator_recovery',ARRAY['mergedOnMain','deployed','scenarioPass'],
    ARRAY['commitSha','workerVersion','checkReceipt','prNumber'],'notice',NULL)
ON CONFLICT DO NOTHING;

CREATE FUNCTION otl.bug_record_verified_operator_recovery(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE
  r otl.bug_reports;
  j otl.bug_jobs;
  run otl.agent_runs;
  transitioned jsonb;
BEGIN
  IF coalesce(p->>'teamId','')='' OR coalesce(p->>'bugId','')=''
     OR coalesce(p->>'adminId','')='' OR coalesce(p->>'commitSha','') !~ '^[0-9a-f]{40,64}$'
     OR coalesce(p->>'workerVersion','') !~ '^[0-9a-f-]{36}$'
     OR coalesce(p->>'checkReceipt','') !~ '^[0-9a-f]{64}$'
     OR (p->>'prNumber')::bigint<1 OR length(coalesce(p->>'summary','')) NOT BETWEEN 1 AND 1200
  THEN RAISE EXCEPTION 'invalid operator recovery' USING ERRCODE='22023'; END IF;

  SELECT * INTO r FROM otl.bug_reports
    WHERE bug_id=p->>'bugId' AND team_id=p->>'teamId' FOR UPDATE;
  IF NOT FOUND OR r.state NOT IN ('fixing','fix_failed')
  THEN RAISE EXCEPTION 'operator recovery state mismatch' USING ERRCODE='40001'; END IF;
  SELECT * INTO j FROM otl.bug_jobs
    WHERE bug_id=r.bug_id AND kind='fix' AND status='failed' AND attempt>=3
    ORDER BY job_id DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'exhausted fix job missing' USING ERRCODE='22023'; END IF;
  SELECT * INTO run FROM otl.agent_runs
    WHERE job_id=j.job_id ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND OR run.provider_task_url IS NULL
  THEN RAISE EXCEPTION 'failed fix run missing' USING ERRCODE='22023'; END IF;

  transitioned:=otl.bug_transition(jsonb_build_object(
    'bugId',r.bug_id,'toState','resolved','variant','verified_operator_recovery',
    'actors',jsonb_build_array('admin','deployer'),
    'guard',jsonb_build_object('mergedOnMain',true,'deployed',true,'scenarioPass',true),
    'evidence',jsonb_build_object(
      'commitSha',p->>'commitSha','workerVersion',p->>'workerVersion',
      'checkReceipt',p->>'checkReceipt','prNumber',(p->>'prNumber')::bigint),
    'expectedRevision',r.revision,
    'idempotencyKey','operator-recovery:'||r.bug_id||':'||(p->>'commitSha')));
  UPDATE otl.bug_reports SET head_sha=p->>'commitSha',deployed_version=p->>'workerVersion'
    WHERE bug_id=r.bug_id;
  INSERT INTO otl.bug_runner_notifications(
    team_id,bug_id,job_id,run_id,channel_id,thread_ts,kind,payload
  ) VALUES(
    r.team_id,r.bug_id,j.job_id,run.run_id,r.source_channel_id,r.source_thread,'change_deployed',
    jsonb_build_object(
      'taskUrl',run.provider_task_url,'attempt',j.attempt,'reporterId',r.reporter_id,
      'adminId',p->>'adminId','summary',left(p->>'summary',1200),
      'workerVersion',p->>'workerVersion','prNumber',(p->>'prNumber')::bigint)
  ) ON CONFLICT(run_id,kind) DO NOTHING;
  RETURN transitioned || jsonb_build_object('notificationQueued',true);
END $$;

REVOKE ALL ON FUNCTION otl.bug_record_verified_operator_recovery(jsonb) FROM PUBLIC;

INSERT INTO otl.schema_migrations(version) VALUES('064-verified-operator-recovery');
COMMIT;
