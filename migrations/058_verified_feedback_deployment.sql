BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

ALTER TABLE otl.bug_runner_notifications DROP CONSTRAINT bug_runner_notifications_kind_check;
ALTER TABLE otl.bug_runner_notifications ADD CONSTRAINT bug_runner_notifications_kind_check
  CHECK (kind IN ('task_started','task_ready','task_failed','merge_ready','change_merged','change_deployed'));

INSERT INTO otl.bug_transition_contract(
  from_state,to_state,variant,actor_requirements,guard_code,required_guard_keys,
  required_evidence_keys,side_effect,resume_state
) VALUES(
  'merged','staging','verified_external_deploy','[["deployer"]]',
  'deploy',ARRAY['mergeOnMain'],ARRAY['environmentReceipt'],'notice',NULL
) ON CONFLICT DO NOTHING;

CREATE FUNCTION otl.bug_record_verified_deployment(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE r otl.bug_reports; change otl.git_changes; run otl.agent_runs; transitioned jsonb;
BEGIN
  IF coalesce(p->>'teamId','')='' OR coalesce(p->>'bugId','')=''
     OR coalesce(p->>'deployerId','')='' OR coalesce(p->>'mergeSha','') !~ '^[0-9a-f]{40}$'
     OR coalesce(p->>'deployedSha','') !~ '^[0-9a-f]{40}$'
     OR coalesce(p->>'workerVersion','') !~ '^[0-9a-f-]{36}$'
     OR coalesce(p->>'environmentReceipt','') !~ '^[0-9a-f]{64}$'
     OR coalesce(p->>'observationReceipt','') !~ '^[0-9a-f]{64}$'
     OR length(coalesce(p->>'liveArtifacts','')) NOT BETWEEN 1 AND 1200
     OR length(coalesce(p->>'summary','')) NOT BETWEEN 1 AND 1200
  THEN RAISE EXCEPTION 'invalid verified deployment receipt' USING ERRCODE='22023'; END IF;
  SELECT * INTO r FROM otl.bug_reports
    WHERE bug_id=p->>'bugId' AND team_id=p->>'teamId' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'deployment bug missing' USING ERRCODE='42501'; END IF;
  SELECT * INTO change FROM otl.git_changes
    WHERE bug_id=r.bug_id AND merged_sha=p->>'mergeSha'
    ORDER BY change_id DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'deployment merge mismatch' USING ERRCODE='42501'; END IF;
  IF r.state='resolved' AND change.deploy_version=p->>'workerVersion' THEN
    RETURN jsonb_build_object('accepted',true,'changed',false,'state',r.state,'idempotent',true);
  END IF;
  IF r.state<>'merged' THEN RAISE EXCEPTION 'deployment state mismatch' USING ERRCODE='40001'; END IF;
  transitioned:=otl.bug_transition(jsonb_build_object(
    'bugId',r.bug_id,'toState','staging','variant','verified_external_deploy',
    'actors',jsonb_build_array('deployer'),'guard',jsonb_build_object('mergeOnMain',true),
    'evidence',jsonb_build_object('environmentReceipt',p->>'environmentReceipt'),
    'expectedRevision',r.revision,'idempotencyKey','deploy:'||r.bug_id||':'||(p->>'workerVersion')));
  SELECT * INTO r FROM otl.bug_reports WHERE bug_reports.bug_id=p->>'bugId';
  PERFORM otl.bug_transition(jsonb_build_object(
    'bugId',r.bug_id,'toState','observing','actors',jsonb_build_array('deploy_observer'),
    'guard',jsonb_build_object('healthPass',true,'scenarioPass',true),
    'evidence',jsonb_build_object('workerVersion',p->>'workerVersion','liveArtifacts',p->>'liveArtifacts'),
    'expectedRevision',r.revision,'idempotencyKey','observe:'||r.bug_id||':'||(p->>'workerVersion')));
  SELECT * INTO r FROM otl.bug_reports WHERE bug_reports.bug_id=p->>'bugId';
  PERFORM otl.bug_transition(jsonb_build_object(
    'bugId',r.bug_id,'toState','resolved','actors',jsonb_build_array('deploy_observer'),
    'guard',jsonb_build_object('windowComplete',true,'bugCheckPass',true),
    'evidence',jsonb_build_object('observationReceipt',p->>'observationReceipt'),
    'expectedRevision',r.revision,'idempotencyKey','resolve:'||r.bug_id||':'||(p->>'workerVersion')));
  UPDATE otl.git_changes SET deploy_version=p->>'workerVersion' WHERE change_id=change.change_id;
  SELECT * INTO run FROM otl.agent_runs WHERE bug_id=r.bug_id AND exit_class='checks_green'
    ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'deployment run missing' USING ERRCODE='22023'; END IF;
  INSERT INTO otl.bug_runner_notifications(
    team_id,bug_id,job_id,run_id,channel_id,thread_ts,kind,payload
  ) VALUES(
    r.team_id,r.bug_id,run.job_id,run.run_id,r.source_channel_id,r.source_thread,'change_deployed',
    jsonb_build_object('taskUrl',run.provider_task_url,'attempt',1,'reporterId',r.reporter_id,
      'adminId',change.approved_by,'summary',left(p->>'summary',1200),'workerVersion',p->>'workerVersion')
  ) ON CONFLICT(run_id,kind) DO NOTHING;
  RETURN jsonb_build_object('accepted',true,'changed',true,'state','resolved','workerVersion',p->>'workerVersion');
END $$;

REVOKE ALL ON FUNCTION otl.bug_record_verified_deployment(jsonb) FROM PUBLIC;

INSERT INTO otl.schema_migrations(version) VALUES('058-verified-feedback-deployment');
COMMIT;
