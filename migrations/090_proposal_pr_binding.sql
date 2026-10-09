BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:proposal-pr-binding:090',0));
ALTER TABLE otl.po_work_pull_requests ADD COLUMN pr_title text NOT NULL DEFAULT 'PR 검토 요청';
INSERT INTO otl.bug_transition_contract(from_state,to_state,variant,actor_requirements,guard_code,
 required_guard_keys,required_evidence_keys,side_effect,resume_state)
VALUES('new','reviewing','external_pull','[["deterministic_worker"]]','external_pull',
 ARRAY['activePo','noRunningJob'],ARRAY['prNumber','headSha','actorId'],'none',NULL) ON CONFLICT DO NOTHING;
INSERT INTO otl.bug_transition_contract(from_state,to_state,variant,actor_requirements,guard_code,
 required_guard_keys,required_evidence_keys,side_effect,resume_state)
VALUES('merge_eligible','reviewing','external_pull','[["deterministic_worker"]]','external_pull',
 ARRAY['activePo','noRunningJob'],ARRAY['prNumber','headSha','actorId'],'none',NULL) ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION otl.community_bind_pull_request(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE report otl.bug_reports; inserted otl.po_work_pull_requests; prior otl.po_work_pull_requests; head_changed boolean:=false;
BEGIN
  IF coalesce(p->>'teamId','')='' OR coalesce(p->>'actorId','')!~'^[UW][A-Z0-9]+$' OR coalesce(p->>'workKey','')!~'^BUG-[A-Z0-9]{8,32}$'
    OR coalesce(p->>'headRepository','')!~'^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' OR coalesce((p->>'number')::bigint,0)<1
    OR p->>'pullUrl'<>'https://github.com/Betalgeuse/ot1l/pull/'||(p->>'number')::bigint::text
    OR coalesce(p->>'headSha','')!~'^[a-f0-9]{40}$' OR jsonb_typeof(p->'paths') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p->'paths') NOT BETWEEN 1 AND 100 OR coalesce(p->>'pathsDigest','')!~'^[a-f0-9]{64}$'
  THEN RAISE EXCEPTION 'invalid pull request binding' USING ERRCODE='22023'; END IF;
  IF p->>'actorId' IS DISTINCT FROM p->>'founderId' AND NOT EXISTS(SELECT 1 FROM otl.community_maintainers
    WHERE team_id=p->>'teamId' AND user_id=p->>'actorId' AND state='active')
  THEN RAISE EXCEPTION 'active Product Owner required' USING ERRCODE='42501'; END IF;
  -- Match the runner's jobs -> report lock order. Never revoke an executing
  -- job that may already be creating a PR outside the database transaction.
  PERFORM 1 FROM otl.bug_jobs WHERE bug_id=p->>'workKey' ORDER BY job_id FOR UPDATE;
  SELECT * INTO report FROM otl.bug_reports WHERE bug_id=p->>'workKey' AND team_id=p->>'teamId' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('accepted',false,'reason','work_unavailable'); END IF;
  SELECT * INTO prior FROM otl.po_work_pull_requests WHERE work_key=report.bug_id AND team_id=report.team_id FOR UPDATE;
  IF FOUND AND prior.pr_number=(p->>'number')::bigint AND prior.head_sha=p->>'headSha'
    AND prior.status IN('queued','claimed','verified')
  THEN RETURN jsonb_build_object('accepted',true,'changed',false,'bindingId',prior.binding_id,'headSha',prior.head_sha); END IF;
  IF prior.status='verified' AND prior.pr_number=(p->>'number')::bigint AND prior.head_sha<>p->>'headSha' THEN
    IF EXISTS(SELECT 1 FROM otl.git_changes WHERE bug_id=report.bug_id AND merge_status IN('approved','claimed','merged'))
      THEN RETURN jsonb_build_object('accepted',false,'reason','approval_in_progress'); END IF;
    UPDATE otl.git_changes SET merge_status='failed' WHERE bug_id=report.bug_id AND pr_number=prior.pr_number
      AND merge_status='awaiting_approval' AND approved_at IS NULL;
    UPDATE otl.po_work_pull_requests SET status='rejected' WHERE binding_id=prior.binding_id;
    head_changed:=true;
  END IF;
  IF report.state NOT IN('new','triaged','queued','reproduced','reproduce_failed','fix_failed','fixing','reviewing','merge_eligible')
    OR NOT EXISTS(SELECT 1 FROM otl.maintainer_feedback_work WHERE team_id=report.team_id AND work_key=report.bug_id)
  THEN RETURN jsonb_build_object('accepted',false,'reason','work_unavailable'); END IF;
  IF EXISTS(SELECT 1 FROM otl.bug_jobs WHERE bug_id=report.bug_id AND status='leased')
  THEN RETURN jsonb_build_object('accepted',false,'reason','automatic_work_running'); END IF;
  IF EXISTS(SELECT 1 FROM otl.git_changes WHERE bug_id=report.bug_id AND (merge_status<>'failed' OR pr_number<>(p->>'number')::bigint))
  THEN RETURN jsonb_build_object('accepted',false,'reason','existing_change'); END IF;
  DELETE FROM otl.po_work_pull_requests WHERE work_key=report.bug_id AND status='rejected';
  INSERT INTO otl.po_work_pull_requests(team_id,work_key,actor_id,repository,pr_number,pull_url,head_sha,changed_paths,paths_digest,packet_revision,pr_title)
  VALUES(p->>'teamId',report.bug_id,p->>'actorId','Betalgeuse/ot1l',(p->>'number')::bigint,p->>'pullUrl',p->>'headSha',p->'paths',p->>'pathsDigest',report.packet_revision,left(coalesce(p->>'title','PR 검토 요청'),1000))
  ON CONFLICT DO NOTHING RETURNING * INTO inserted;
  IF NOT FOUND THEN RETURN jsonb_build_object('accepted',false,'reason','duplicate'); END IF;
  UPDATE otl.bug_jobs SET status='cancelled',cancel_reason='external_pull_bound',finished_at=clock_timestamp(),
    updated_at=clock_timestamp() WHERE bug_id=report.bug_id AND status='queued';
  PERFORM otl.bug_transition(jsonb_build_object('bugId',report.bug_id,'toState','reviewing','variant','external_pull',
    'actors',jsonb_build_array('deterministic_worker'),'guard',jsonb_build_object('activePo',true,'noRunningJob',true),
    'evidence',jsonb_build_object('prNumber',inserted.pr_number,'headSha',inserted.head_sha,'actorId',inserted.actor_id),
    'expectedRevision',report.revision,'idempotencyKey','bound-pull:'||inserted.binding_id));
  RETURN jsonb_build_object('accepted',true,'bindingId',inserted.binding_id,'headSha',inserted.head_sha,'headShaChanged',head_changed);
END $$;


CREATE OR REPLACE FUNCTION otl.bug_runner_finish_bound_pull(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE binding otl.po_work_pull_requests; report otl.bug_reports; packet_revision otl.bug_report_revisions;
  job_id bigint; run_id text; change_id bigint;
BEGIN
  SELECT * INTO binding FROM otl.po_work_pull_requests WHERE binding_id=(p->>'bindingId')::bigint FOR UPDATE;
  IF NOT FOUND OR binding.team_id IS DISTINCT FROM p->>'teamId' OR binding.status<>'claimed' OR binding.worker_id IS DISTINCT FROM p->>'workerId' OR binding.lease_token IS DISTINCT FROM p->>'leaseToken'
    OR binding.lease_expires_at<=clock_timestamp()
    OR binding.head_sha IS DISTINCT FROM p->>'headSha' OR binding.changed_paths IS DISTINCT FROM p->'changedPaths'
    OR coalesce(p->>'changeClass','') NOT IN('open','core') OR coalesce(p->>'classificationDigest','')!~'^[a-f0-9]{64}$'
  THEN RAISE EXCEPTION 'bound pull verification lease lost' USING ERRCODE='40001'; END IF;
  SELECT * INTO report FROM otl.bug_reports WHERE bug_id=binding.work_key AND team_id=binding.team_id FOR UPDATE;
  IF report.state<>'reviewing' OR report.packet_revision<>binding.packet_revision
    OR EXISTS(SELECT 1 FROM otl.git_changes WHERE bug_id=report.bug_id AND merge_status<>'failed')
  THEN RAISE EXCEPTION 'bound work changed'; END IF;
  SELECT * INTO packet_revision FROM otl.bug_report_revisions revisions
    WHERE revisions.bug_id=report.bug_id AND revisions.packet_revision=report.packet_revision;
  INSERT INTO otl.bug_jobs(bug_id,kind,status,payload,payload_digest,attempt,finished_at)
    VALUES(report.bug_id,'review','succeeded',jsonb_build_object('externalPull',binding.pr_number),
      p->>'classificationDigest',1,transaction_timestamp()) RETURNING bug_jobs.job_id INTO job_id;
  run_id:='bound-pr-'||binding.binding_id::text;
  INSERT INTO otl.agent_runs(run_id,bug_id,job_id,account_alias,base_sha,prompt_digest,exit_class,artifact_digest)
    VALUES(run_id,report.bug_id,job_id,'genquant-bound-pr',binding.head_sha,p->>'classificationDigest','checks_green',p->>'classificationDigest');
  INSERT INTO otl.git_changes(bug_id,commit_sha,pr_number,change_class,changed_paths,classification_digest,classified_at)
    VALUES(report.bug_id,binding.head_sha,binding.pr_number,p->>'changeClass',binding.changed_paths,p->>'classificationDigest',transaction_timestamp())
    RETURNING git_changes.change_id INTO change_id;
  PERFORM otl.bug_transition(jsonb_build_object('bugId',report.bug_id,'toState','merge_eligible','variant','external_pull_verified',
    'actors',jsonb_build_array('deterministic_worker'),'guard',jsonb_build_object('fullCheckGreen',true,'exactSha',true,'exclusiveBinding',true),
    'evidence',jsonb_build_object('prNumber',binding.pr_number,'headSha',binding.head_sha,'checkReceipt',p->>'classificationDigest'),
    'expectedRevision',report.revision,'idempotencyKey','bound-pull-verified:'||binding.binding_id));
  UPDATE otl.po_work_pull_requests SET status='verified',worker_id=NULL,lease_token=NULL,lease_expires_at=NULL,
    verified_at=transaction_timestamp() WHERE binding_id=binding.binding_id;
  INSERT INTO otl.bug_runner_notifications(team_id,bug_id,job_id,run_id,channel_id,thread_ts,kind,payload)
  VALUES(report.team_id,report.bug_id,job_id,run_id,report.source_channel_id,report.source_thread,'merge_ready',
    jsonb_build_object('attempt',1,'reporterId',report.reporter_id,'adminId',binding.actor_id,
      'summary','GenQuant exact SHA checkout과 bun run check를 통과했습니다.','prNumber',binding.pr_number,
      'prUrl',binding.pull_url,'packetRevision',report.packet_revision,
      'asIs',coalesce(packet_revision.confirmed_packet->'fields'->>'actual',(SELECT actual FROM otl.maintainer_feedback_work WHERE team_id=report.team_id AND work_key=report.bug_id)),
      'toBe',coalesce(nullif(packet_revision.confirmed_packet->'fields'->>'expected',''),binding.pr_title),
      'changeClass',p->>'changeClass','headSha',binding.head_sha,'classificationDigest',p->>'classificationDigest'));
  RETURN jsonb_build_object('accepted',true,'changeId',change_id);
END $$;


INSERT INTO otl.schema_migrations(version) VALUES('090-proposal-pr-binding');
COMMIT;
