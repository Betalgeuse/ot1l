BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:repository-identity:061',0));

CREATE OR REPLACE FUNCTION otl.bug_runner_finish_fix(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE j otl.bug_jobs; r otl.bug_reports; run otl.agent_runs; finished jsonb; transitioned jsonb;
  admin_id text; packet jsonb; change otl.git_changes;
BEGIN
  IF coalesce(p->>'teamId','')='' OR coalesce(p->>'runId','')=''
     OR coalesce(p->>'resultDigest','') !~ '^[0-9a-f]{64}$'
     OR coalesce(p->>'artifactDigest','') !~ '^[0-9a-f]{64}$'
     OR coalesce(p->>'headSha','') !~ '^[0-9a-f]{40,64}$'
     OR coalesce(p->>'branch','') !~ '^feedback/[a-z0-9-]{1,120}$'
     OR coalesce(p->>'repository','') !~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
     OR (p->>'prNumber')::bigint<1 OR length(coalesce(p->>'summary','')) NOT BETWEEN 1 AND 1200
     OR coalesce(p->>'prUrl','')<>(
       'https://github.com/'||(p->>'repository')||'/pull/'||(p->>'prNumber')::bigint::text
     )
  THEN RAISE EXCEPTION 'invalid fix finish' USING ERRCODE='22023'; END IF;
  SELECT jobs.* INTO j FROM otl.bug_jobs jobs JOIN otl.bug_reports reports ON reports.bug_id=jobs.bug_id
    WHERE jobs.job_id=(p->>'jobId')::bigint AND reports.team_id=p->>'teamId' FOR UPDATE OF jobs;
  IF NOT FOUND OR j.kind<>'fix' OR j.status<>'leased' OR j.worker_id<>p->>'workerId' OR j.lease_token<>p->>'leaseToken'
  THEN RAISE EXCEPTION 'fix lease lost' USING ERRCODE='40001'; END IF;
  SELECT * INTO r FROM otl.bug_reports WHERE bug_id=j.bug_id FOR UPDATE;
  SELECT * INTO run FROM otl.agent_runs WHERE run_id=p->>'runId' AND job_id=j.job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fix run missing' USING ERRCODE='22023'; END IF;
  UPDATE otl.agent_runs SET exit_class='checks_green',elapsed_ms=(p->>'elapsedMs')::bigint,
    artifact_digest=p->>'artifactDigest' WHERE run_id=run.run_id;
  finished:=otl.bug_finish_job(jsonb_build_object('jobId',j.job_id,'workerId',j.worker_id,
    'leaseToken',j.lease_token,'status','succeeded','resultDigest',p->>'resultDigest'));
  INSERT INTO otl.git_changes(bug_id,branch,commit_sha,pr_number)
    VALUES(j.bug_id,p->>'branch',p->>'headSha',(p->>'prNumber')::bigint)
    RETURNING * INTO change;
  transitioned:=otl.bug_transition(jsonb_build_object(
    'bugId',j.bug_id,'toState','merge_eligible','variant','genquant_green',
    'actors',jsonb_build_array('deterministic_worker'),
    'guard',jsonb_build_object('patchApplies',true,'fullCheckGreen',true,'noForbiddenPaths',true),
    'evidence',jsonb_build_object('branch',p->>'branch','headSha',p->>'headSha',
      'checkReceipt',p->>'resultDigest','repository',p->>'repository','prNumber',p->>'prNumber'),
    'expectedRevision',r.revision,'idempotencyKey','runner-fix-green:'||run.run_id));
  SELECT evidence->>'adminId' INTO admin_id FROM otl.bug_events
    WHERE bug_id=r.bug_id AND to_state='queued' ORDER BY event_id LIMIT 1;
  SELECT confirmed_packet INTO packet FROM otl.bug_report_revisions
    WHERE bug_id=r.bug_id AND packet_revision=r.packet_revision;
  INSERT INTO otl.bug_runner_notifications(team_id,bug_id,job_id,run_id,channel_id,thread_ts,kind,payload)
  VALUES(r.team_id,r.bug_id,j.job_id,run.run_id,r.source_channel_id,r.source_thread,'merge_ready',
    jsonb_build_object('taskUrl',run.provider_task_url,'attempt',j.attempt,'reporterId',r.reporter_id,
      'adminId',admin_id,'summary',left(p->>'summary',1200),'prNumber',change.pr_number,
      'prUrl',p->>'prUrl','packetRevision',r.packet_revision,
      'asIs',packet->'fields'->>'actual','toBe',packet->'fields'->>'expected'))
  ON CONFLICT(run_id,kind) DO NOTHING;
  RETURN jsonb_build_object('job',finished,'transition',transitioned,'change',to_jsonb(change));
END $$;

REVOKE ALL ON FUNCTION otl.bug_runner_finish_fix(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION otl.bug_runner_finish_fix(jsonb) TO otl_bug_runner;

INSERT INTO otl.schema_migrations(version) VALUES('061-repository-identity');
COMMIT;
