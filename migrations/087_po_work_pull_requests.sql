BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:po-work-pull-requests:087',0));

CREATE TABLE otl.po_work_pull_requests(
  binding_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id text NOT NULL,
  work_key text NOT NULL REFERENCES otl.bug_reports(bug_id) ON DELETE CASCADE,
  actor_id text NOT NULL CHECK(actor_id~'^[UW][A-Z0-9]+$'),
  repository text NOT NULL CHECK(repository='Betalgeuse/ot1l'),
  pr_number bigint NOT NULL CHECK(pr_number>0),
  pull_url text NOT NULL,
  head_sha text NOT NULL CHECK(head_sha~'^[a-f0-9]{40}$'),
  changed_paths jsonb NOT NULL CHECK(jsonb_typeof(changed_paths)='array'),
  paths_digest text NOT NULL CHECK(paths_digest~'^[a-f0-9]{64}$'),
  packet_revision integer NOT NULL,
  attempt integer NOT NULL DEFAULT 0 CHECK(attempt BETWEEN 0 AND 3),
  failure_reason text,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','claimed','verified','rejected')),
  worker_id text, lease_token text, lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(), verified_at timestamptz,
  UNIQUE(repository,pr_number), UNIQUE(work_key),
  CHECK((status='claimed')=(worker_id IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
);

INSERT INTO otl.bug_transition_contract(from_state,to_state,variant,actor_requirements,guard_code,
  required_guard_keys,required_evidence_keys,side_effect,resume_state)
SELECT state,'reviewing','external_pull','[["deterministic_worker"]]'::jsonb,'external_pull',
  ARRAY['activePo','noRunningJob'],ARRAY['prNumber','headSha','actorId'],'none',NULL
FROM unnest(ARRAY['triaged','queued','reproduced','reproduce_failed','fix_failed','fixing','reviewing']) AS state
ON CONFLICT DO NOTHING;
INSERT INTO otl.bug_transition_contract(from_state,to_state,variant,actor_requirements,guard_code,
  required_guard_keys,required_evidence_keys,side_effect,resume_state)
VALUES('reviewing','merge_eligible','external_pull_verified','[["deterministic_worker"]]',
  'external_pull_verified',ARRAY['fullCheckGreen','exactSha','exclusiveBinding'],
  ARRAY['prNumber','headSha','checkReceipt'],'none',NULL) ON CONFLICT DO NOTHING;

CREATE FUNCTION otl.community_bind_pull_request(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE report otl.bug_reports; inserted otl.po_work_pull_requests;
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
  IF NOT FOUND OR report.state NOT IN('triaged','queued','reproduced','reproduce_failed','fix_failed','fixing','reviewing')
    OR NOT EXISTS(SELECT 1 FROM otl.bug_report_revisions WHERE bug_id=report.bug_id
      AND packet_revision=report.packet_revision AND confirmed_packet->>'schemaVersion'='feedback_packet.v1')
  THEN RETURN jsonb_build_object('accepted',false,'reason','work_unavailable'); END IF;
  IF EXISTS(SELECT 1 FROM otl.bug_jobs WHERE bug_id=report.bug_id AND status='leased')
  THEN RETURN jsonb_build_object('accepted',false,'reason','automatic_work_running'); END IF;
  IF EXISTS(SELECT 1 FROM otl.git_changes WHERE bug_id=report.bug_id)
  THEN RETURN jsonb_build_object('accepted',false,'reason','existing_change'); END IF;
  DELETE FROM otl.po_work_pull_requests WHERE work_key=report.bug_id AND status='rejected';
  INSERT INTO otl.po_work_pull_requests(team_id,work_key,actor_id,repository,pr_number,pull_url,head_sha,changed_paths,paths_digest,packet_revision)
  VALUES(p->>'teamId',report.bug_id,p->>'actorId','Betalgeuse/ot1l',(p->>'number')::bigint,p->>'pullUrl',p->>'headSha',p->'paths',p->>'pathsDigest',report.packet_revision)
  ON CONFLICT DO NOTHING RETURNING * INTO inserted;
  IF NOT FOUND THEN RETURN jsonb_build_object('accepted',false,'reason','duplicate'); END IF;
  UPDATE otl.bug_jobs SET status='cancelled',cancel_reason='external_pull_bound',finished_at=clock_timestamp(),
    updated_at=clock_timestamp() WHERE bug_id=report.bug_id AND status='queued';
  PERFORM otl.bug_transition(jsonb_build_object('bugId',report.bug_id,'toState','reviewing','variant','external_pull',
    'actors',jsonb_build_array('deterministic_worker'),'guard',jsonb_build_object('activePo',true,'noRunningJob',true),
    'evidence',jsonb_build_object('prNumber',inserted.pr_number,'headSha',inserted.head_sha,'actorId',inserted.actor_id),
    'expectedRevision',report.revision,'idempotencyKey','bound-pull:'||inserted.binding_id));
  RETURN jsonb_build_object('accepted',true,'bindingId',inserted.binding_id,'headSha',inserted.head_sha);
END $$;

CREATE FUNCTION otl.bug_runner_claim_bound_pull(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE binding otl.po_work_pull_requests;
BEGIN
  IF coalesce(p->>'teamId','')='' OR coalesce(p->>'workerId','')='' OR coalesce(p->>'leaseToken','')=''
  THEN RAISE EXCEPTION 'invalid bound pull claim'; END IF;
  FOR binding IN SELECT * FROM otl.po_work_pull_requests WHERE team_id=p->>'teamId'
    AND status='claimed' AND lease_expires_at<clock_timestamp() AND attempt>=3 FOR UPDATE LOOP
    PERFORM otl.bug_runner_fail_bound_pull(jsonb_build_object('teamId',binding.team_id,'bindingId',binding.binding_id,
      'workerId',binding.worker_id,'leaseToken',binding.lease_token));
  END LOOP;
  UPDATE otl.po_work_pull_requests SET status='queued',worker_id=NULL,lease_token=NULL,lease_expires_at=NULL
    WHERE team_id=p->>'teamId' AND status='claimed' AND lease_expires_at<clock_timestamp();
  SELECT * INTO binding FROM otl.po_work_pull_requests WHERE team_id=p->>'teamId' AND status='queued'
    ORDER BY binding_id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN 'null'::jsonb; END IF;
  UPDATE otl.po_work_pull_requests SET status='claimed',attempt=attempt+1,worker_id=p->>'workerId',lease_token=p->>'leaseToken',
    lease_expires_at=clock_timestamp()+interval '30 minutes' WHERE binding_id=binding.binding_id RETURNING * INTO binding;
  RETURN to_jsonb(binding);
END $$;

CREATE FUNCTION otl.bug_runner_finish_bound_pull(p jsonb) RETURNS jsonb
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
    OR EXISTS(SELECT 1 FROM otl.git_changes WHERE bug_id=report.bug_id)
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
      'asIs',packet_revision.confirmed_packet->'fields'->>'actual','toBe',packet_revision.confirmed_packet->'fields'->>'expected',
      'changeClass',p->>'changeClass','headSha',binding.head_sha,'classificationDigest',p->>'classificationDigest'));
  RETURN jsonb_build_object('accepted',true,'changeId',change_id);
END $$;

CREATE FUNCTION otl.bug_runner_fail_bound_pull(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE binding otl.po_work_pull_requests; report otl.bug_reports; job_id bigint; run_id text;
BEGIN
  UPDATE otl.po_work_pull_requests SET status='rejected',worker_id=NULL,lease_token=NULL,lease_expires_at=NULL,
    failure_reason='verification_failed'
  WHERE binding_id=(p->>'bindingId')::bigint AND team_id=p->>'teamId' AND status='claimed'
    AND worker_id=p->>'workerId' AND lease_token=p->>'leaseToken' RETURNING * INTO binding;
  IF NOT FOUND THEN RAISE EXCEPTION 'bound pull lease lost'; END IF;
  SELECT * INTO report FROM otl.bug_reports WHERE bug_id=binding.work_key;
  INSERT INTO otl.bug_jobs(bug_id,kind,status,payload,payload_digest,attempt,finished_at)
    VALUES(report.bug_id,'review','failed',jsonb_build_object('externalPull',binding.pr_number),binding.paths_digest,1,clock_timestamp())
    RETURNING bug_jobs.job_id INTO job_id;
  run_id:='bound-pr-failed-'||binding.binding_id;
  INSERT INTO otl.agent_runs(run_id,bug_id,job_id,account_alias,base_sha,prompt_digest,exit_class)
    VALUES(run_id,report.bug_id,job_id,'genquant-bound-pr',binding.head_sha,binding.paths_digest,'verification_failed');
  INSERT INTO otl.bug_runner_notifications(team_id,bug_id,job_id,run_id,channel_id,thread_ts,kind,payload)
    VALUES(report.team_id,report.bug_id,job_id,run_id,report.source_channel_id,report.source_thread,'task_failed',
      jsonb_build_object('attempt',1,'reporterId',binding.actor_id,'asIs',report.actual,'toBe',report.expected,
        'summary','PR 검증을 완료하지 못했어요. PR이 열려 있는지와 검사 결과를 확인한 뒤 PR 연결하기로 다시 요청해 주세요.'));
  RETURN jsonb_build_object('accepted',true);
END $$;

REVOKE ALL ON TABLE otl.po_work_pull_requests FROM PUBLIC,otl_bug_runner;
REVOKE ALL ON FUNCTION otl.community_bind_pull_request(jsonb),otl.bug_runner_claim_bound_pull(jsonb),otl.bug_runner_finish_bound_pull(jsonb),otl.bug_runner_fail_bound_pull(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION otl.bug_runner_claim_bound_pull(jsonb),otl.bug_runner_finish_bound_pull(jsonb),otl.bug_runner_fail_bound_pull(jsonb) TO otl_bug_runner;
INSERT INTO otl.schema_migrations(version) VALUES('087-po-work-pull-requests');
COMMIT;
