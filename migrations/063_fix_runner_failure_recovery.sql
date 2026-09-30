BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:fix-runner-failure-recovery:063',0));

CREATE FUNCTION otl.bug_runner_fail_fix(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE
  j otl.bug_jobs;
  r otl.bug_reports;
  run otl.agent_runs;
  admin_id text;
  finished jsonb;
  at_time timestamptz:=coalesce((p->>'now')::timestamptz,clock_timestamp());
BEGIN
  IF coalesce(p->>'teamId','')='' OR coalesce(p->>'runId','')=''
     OR coalesce(p->>'exitClass','')='' OR coalesce(p->>'errorCode','')=''
     OR coalesce(p->>'resultDigest','') !~ '^[0-9a-f]{64}$'
     OR coalesce(p->>'artifactDigest','') !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'invalid fix failure' USING ERRCODE='22023'; END IF;

  SELECT jobs.* INTO j FROM otl.bug_jobs jobs
  JOIN otl.bug_reports reports ON reports.bug_id=jobs.bug_id
  WHERE jobs.job_id=(p->>'jobId')::bigint AND reports.team_id=p->>'teamId'
  FOR UPDATE OF jobs;
  IF NOT FOUND OR j.kind<>'fix' OR j.status<>'leased'
     OR j.worker_id<>p->>'workerId' OR j.lease_token<>p->>'leaseToken'
  THEN RAISE EXCEPTION 'fix lease lost' USING ERRCODE='40001'; END IF;

  SELECT * INTO r FROM otl.bug_reports WHERE bug_id=j.bug_id FOR UPDATE;
  SELECT * INTO run FROM otl.agent_runs
    WHERE run_id=p->>'runId' AND job_id=j.job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fix run missing' USING ERRCODE='22023'; END IF;

  UPDATE otl.agent_runs SET
    exit_class=left(p->>'exitClass',120),
    elapsed_ms=(p->>'elapsedMs')::bigint,
    artifact_digest=p->>'artifactDigest'
  WHERE run_id=run.run_id;

  IF j.attempt<3 THEN
    UPDATE otl.bug_jobs SET
      status='queued', available_at=at_time+make_interval(secs=>15*j.attempt),
      worker_id=NULL, lease_token=NULL, lease_expires_at=NULL, heartbeat_at=NULL,
      result_digest=NULL, finished_at=NULL, updated_at=at_time
    WHERE job_id=j.job_id RETURNING * INTO j;
    RETURN jsonb_build_object('job',to_jsonb(j),'retry',true);
  END IF;

  finished:=otl.bug_finish_job(jsonb_build_object(
    'jobId',j.job_id,'workerId',j.worker_id,'leaseToken',j.lease_token,
    'status','failed','resultDigest',p->>'resultDigest','now',at_time));
  PERFORM otl.bug_transition(jsonb_build_object(
    'bugId',j.bug_id,'toState','fix_failed','actors',jsonb_build_array('deterministic_worker'),
    'guard',jsonb_build_object('fixFailed',true),
    'evidence',jsonb_build_object('runReceipt',p->>'resultDigest'),
    'expectedRevision',r.revision,'idempotencyKey','runner-fix-failed:'||run.run_id,'now',at_time));
  SELECT evidence->>'adminId' INTO admin_id FROM otl.bug_events
    WHERE bug_id=r.bug_id AND to_state='queued' ORDER BY event_id LIMIT 1;
  INSERT INTO otl.bug_runner_notifications(
    team_id,bug_id,job_id,run_id,channel_id,thread_ts,kind,payload
  ) VALUES(
    r.team_id,r.bug_id,j.job_id,run.run_id,r.source_channel_id,r.source_thread,'task_failed',
    jsonb_build_object(
      'taskUrl',run.provider_task_url,'attempt',j.attempt,'reporterId',r.reporter_id,
      'adminId',admin_id,'summary','자동 수정 검증을 세 번 통과하지 못해 운영자 확인으로 전환했습니다.',
      'errorCode',left(p->>'errorCode',120)
    )
  ) ON CONFLICT(run_id,kind) DO NOTHING;
  RETURN jsonb_build_object('job',finished,'retry',false,'state','fix_failed');
END $$;

REVOKE ALL ON FUNCTION otl.bug_runner_fail_fix(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION otl.bug_runner_fail_fix(jsonb) TO otl_bug_runner;

INSERT INTO otl.schema_migrations(version) VALUES('063-fix-runner-failure-recovery');
COMMIT;
