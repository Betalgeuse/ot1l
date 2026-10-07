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
  status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','claimed','verified','rejected')),
  worker_id text, lease_token text, lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(), verified_at timestamptz,
  UNIQUE(repository,pr_number), UNIQUE(work_key),
  CHECK((status='claimed')=(worker_id IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
);

CREATE FUNCTION otl.community_bind_pull_request(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE report otl.bug_reports; inserted otl.po_work_pull_requests;
BEGIN
  IF p->>'teamId'='' OR p->>'actorId'!~'^[UW][A-Z0-9]+$' OR p->>'workKey'!~'^BUG-[A-Z0-9]{8,32}$'
    OR p->>'headRepository'<>'Betalgeuse/ot1l' OR (p->>'number')::bigint<1
    OR p->>'pullUrl'<>'https://github.com/Betalgeuse/ot1l/pull/'||(p->>'number')::bigint::text
    OR p->>'headSha'!~'^[a-f0-9]{40}$' OR jsonb_typeof(p->'paths')<>'array'
    OR jsonb_array_length(p->'paths') NOT BETWEEN 1 AND 100 OR p->>'pathsDigest'!~'^[a-f0-9]{64}$'
  THEN RAISE EXCEPTION 'invalid pull request binding' USING ERRCODE='22023'; END IF;
  IF p->>'actorId'<>p->>'founderId' AND NOT EXISTS(SELECT 1 FROM otl.community_maintainers
    WHERE team_id=p->>'teamId' AND user_id=p->>'actorId' AND state='active')
  THEN RAISE EXCEPTION 'active Product Owner required' USING ERRCODE='42501'; END IF;
  SELECT * INTO report FROM otl.bug_reports WHERE bug_id=p->>'workKey' AND team_id=p->>'teamId' FOR UPDATE;
  IF NOT FOUND OR report.state NOT IN('triaged','queued','reproducing','fixing')
    OR NOT EXISTS(SELECT 1 FROM otl.bug_report_revisions WHERE bug_id=report.bug_id
      AND packet_revision=report.packet_revision AND confirmed_packet->>'schemaVersion'='feedback_packet.v1')
  THEN RETURN jsonb_build_object('accepted',false,'reason','work_unavailable'); END IF;
  INSERT INTO otl.po_work_pull_requests(team_id,work_key,actor_id,repository,pr_number,pull_url,head_sha,changed_paths,paths_digest)
  VALUES(p->>'teamId',report.bug_id,p->>'actorId','Betalgeuse/ot1l',(p->>'number')::bigint,p->>'pullUrl',p->>'headSha',p->'paths',p->>'pathsDigest')
  ON CONFLICT DO NOTHING RETURNING * INTO inserted;
  IF NOT FOUND THEN RETURN jsonb_build_object('accepted',false,'reason','duplicate'); END IF;
  RETURN jsonb_build_object('accepted',true,'bindingId',inserted.binding_id,'headSha',inserted.head_sha);
END $$;

CREATE FUNCTION otl.bug_runner_claim_bound_pull(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE binding otl.po_work_pull_requests;
BEGIN
  UPDATE otl.po_work_pull_requests SET status='queued',worker_id=NULL,lease_token=NULL,lease_expires_at=NULL
    WHERE status='claimed' AND lease_expires_at<clock_timestamp();
  SELECT * INTO binding FROM otl.po_work_pull_requests WHERE team_id=p->>'teamId' AND status='queued'
    ORDER BY binding_id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN 'null'::jsonb; END IF;
  UPDATE otl.po_work_pull_requests SET status='claimed',worker_id=p->>'workerId',lease_token=p->>'leaseToken',
    lease_expires_at=clock_timestamp()+interval '20 minutes' WHERE binding_id=binding.binding_id RETURNING * INTO binding;
  RETURN to_jsonb(binding);
END $$;

CREATE FUNCTION otl.bug_runner_finish_bound_pull(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE binding otl.po_work_pull_requests; report otl.bug_reports; packet_revision otl.bug_report_revisions;
  job_id bigint; run_id text; change_id bigint;
BEGIN
  SELECT * INTO binding FROM otl.po_work_pull_requests WHERE binding_id=(p->>'bindingId')::bigint FOR UPDATE;
  IF NOT FOUND OR binding.status<>'claimed' OR binding.worker_id<>p->>'workerId' OR binding.lease_token<>p->>'leaseToken'
    OR binding.head_sha<>p->>'headSha' OR binding.changed_paths<>p->'changedPaths'
    OR p->>'changeClass' NOT IN('open','core') OR p->>'classificationDigest'!~'^[a-f0-9]{64}$'
  THEN RAISE EXCEPTION 'bound pull verification lease lost' USING ERRCODE='40001'; END IF;
  SELECT * INTO report FROM otl.bug_reports WHERE bug_id=binding.work_key AND team_id=binding.team_id FOR UPDATE;
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
  UPDATE otl.bug_reports SET state='merge_eligible',revision=otl.bug_reports.revision+1,
    updated_at=transaction_timestamp() WHERE bug_id=report.bug_id;
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

REVOKE ALL ON TABLE otl.po_work_pull_requests FROM PUBLIC,otl_bug_runner;
REVOKE ALL ON FUNCTION otl.community_bind_pull_request(jsonb),otl.bug_runner_claim_bound_pull(jsonb),otl.bug_runner_finish_bound_pull(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION otl.bug_runner_claim_bound_pull(jsonb),otl.bug_runner_finish_bound_pull(jsonb) TO otl_bug_runner;
INSERT INTO otl.schema_migrations(version) VALUES('087-po-work-pull-requests');
COMMIT;
