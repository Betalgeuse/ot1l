BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:durable-pr-metadata:092',0));

CREATE TABLE otl.po_pr_metadata_requests (
 request_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 team_id text NOT NULL, work_key text NOT NULL REFERENCES otl.bug_reports(bug_id),
 actor_id text NOT NULL, founder_id text NOT NULL, pr_number bigint NOT NULL CHECK(pr_number>0),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','claimed','bound','draft','rejected')),
 attempt integer NOT NULL DEFAULT 0 CHECK(attempt BETWEEN 0 AND 3),
 worker_id text, lease_token text, lease_expires_at timestamptz,
 not_before timestamptz NOT NULL DEFAULT clock_timestamp(), error_code text, head_sha text,
 revision integer NOT NULL DEFAULT 1, notified_revision integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(team_id,pr_number), UNIQUE(team_id,work_key),
 CHECK((status='claimed')=(worker_id IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
);

CREATE FUNCTION otl.community_queue_pr_metadata(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE r otl.po_pr_metadata_requests;
BEGIN
 IF coalesce(p->>'teamId','')='' OR coalesce(p->>'actorId','')!~'^[UW][A-Z0-9]+$'
   OR coalesce(p->>'founderId','')!~'^[UW][A-Z0-9]+$' OR coalesce(p->>'workKey','')!~'^BUG-[A-Z0-9]{8,32}$'
   OR coalesce((p->>'prNumber')::bigint,0)<1 THEN RAISE EXCEPTION 'invalid PR lookup request'; END IF;
 IF p->>'actorId' IS DISTINCT FROM p->>'founderId' AND NOT EXISTS(SELECT 1 FROM otl.community_maintainers
   WHERE team_id=p->>'teamId' AND user_id=p->>'actorId' AND state='active')
   THEN RAISE EXCEPTION 'active PO required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM otl.maintainer_feedback_work WHERE team_id=p->>'teamId' AND work_key=p->>'workKey'
   AND pr_number=(p->>'prNumber')::bigint) THEN RAISE EXCEPTION 'work PR identity mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM otl.bug_jobs WHERE bug_id=p->>'workKey' AND status IN('queued','leased'))
   THEN RETURN jsonb_build_object('accepted',false,'reason','automatic_work_running'); END IF;
 INSERT INTO otl.po_pr_metadata_requests(team_id,work_key,actor_id,founder_id,pr_number)
 VALUES(p->>'teamId',p->>'workKey',p->>'actorId',p->>'founderId',(p->>'prNumber')::bigint)
 ON CONFLICT(team_id,pr_number) DO NOTHING;
 SELECT * INTO r FROM otl.po_pr_metadata_requests WHERE team_id=p->>'teamId' AND pr_number=(p->>'prNumber')::bigint FOR UPDATE;
 IF r.work_key<>p->>'workKey' THEN RAISE EXCEPTION 'PR belongs to another work'; END IF;
 IF r.status IN('bound','draft','rejected') THEN
  UPDATE otl.po_pr_metadata_requests SET status='queued',attempt=0,actor_id=p->>'actorId',founder_id=p->>'founderId',
   error_code=NULL,head_sha=NULL,not_before=clock_timestamp(),revision=revision+1 WHERE request_id=r.request_id RETURNING * INTO r;
 END IF;
 RETURN jsonb_build_object('accepted',true,'requestId',r.request_id,'status',r.status);
END $$;

CREATE FUNCTION otl.bug_runner_claim_pr_metadata(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE r otl.po_pr_metadata_requests;
BEGIN
 IF coalesce(p->>'teamId','')='' OR coalesce(p->>'workerId','')='' OR coalesce(p->>'leaseToken','')=''
  THEN RAISE EXCEPTION 'invalid PR lookup claim'; END IF;
 UPDATE otl.po_pr_metadata_requests SET status=CASE WHEN attempt>=3 THEN 'rejected' ELSE 'queued' END,
  worker_id=NULL,lease_token=NULL,lease_expires_at=NULL,error_code='lookup_interrupted',revision=revision+1
 WHERE team_id=p->>'teamId' AND status='claimed' AND lease_expires_at<clock_timestamp();
 SELECT * INTO r FROM otl.po_pr_metadata_requests WHERE team_id=p->>'teamId' AND status='queued'
  AND not_before<=clock_timestamp() ORDER BY request_id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN 'null'::jsonb; END IF;
 UPDATE otl.po_pr_metadata_requests SET status='claimed',attempt=attempt+1,worker_id=p->>'workerId',lease_token=p->>'leaseToken',
  lease_expires_at=clock_timestamp()+interval '5 minutes' WHERE request_id=r.request_id RETURNING * INTO r;
 RETURN to_jsonb(r);
END $$;

CREATE FUNCTION otl.bug_runner_finish_pr_metadata(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE r otl.po_pr_metadata_requests; result jsonb; next_status text; err text; delay_seconds integer;
BEGIN
 SELECT * INTO r FROM otl.po_pr_metadata_requests WHERE request_id=(p->>'requestId')::bigint FOR UPDATE;
 IF NOT FOUND OR r.team_id IS DISTINCT FROM p->>'teamId' OR r.status<>'claimed'
  OR r.worker_id IS DISTINCT FROM p->>'workerId' OR r.lease_token IS DISTINCT FROM p->>'leaseToken'
  OR r.lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'PR lookup lease lost' USING ERRCODE='40001'; END IF;
 IF r.actor_id<>r.founder_id AND NOT EXISTS(SELECT 1 FROM otl.community_maintainers WHERE team_id=r.team_id AND user_id=r.actor_id AND state='active') THEN
  next_status:='rejected';err:='actor_inactive';
 ELSIF p->>'outcome'='ready' THEN
  result:=otl.community_bind_pull_request((p->'metadata')||jsonb_build_object(
   'teamId',r.team_id,'actorId',r.actor_id,'founderId',r.founder_id,'workKey',r.work_key,
   'number',r.pr_number,'pullUrl','https://github.com/Betalgeuse/ot1l/pull/'||r.pr_number));
  next_status:=CASE WHEN result->>'accepted'='true' THEN 'bound' ELSE 'rejected' END;
  err:=CASE WHEN next_status='rejected' THEN 'binding_conflict' ELSE NULL END;
 ELSIF p->>'outcome'='draft' THEN next_status:='draft';
 ELSE
  err:=CASE WHEN p->>'errorCode' IN('github_rate_limited','github_unavailable','pr_not_open','pr_wrong_base','pr_missing','pr_too_large','pr_changed','pr_invalid_metadata')
    THEN p->>'errorCode' ELSE 'github_unavailable' END;
  next_status:=CASE WHEN p->>'retryable'='true' AND r.attempt<3 THEN 'queued' ELSE 'rejected' END;
 END IF;
 delay_seconds:=greatest(60,least(coalesce((p->>'retryAfterSeconds')::integer,60*r.attempt),86400));
 UPDATE otl.po_pr_metadata_requests SET status=next_status,error_code=err,worker_id=NULL,lease_token=NULL,lease_expires_at=NULL,
  not_before=clock_timestamp()+make_interval(secs=>delay_seconds),head_sha=CASE WHEN next_status='bound' THEN p->'metadata'->>'headSha' ELSE NULL END,
  revision=revision+1 WHERE request_id=r.request_id;
 RETURN jsonb_build_object('accepted',true,'status',next_status);
END $$;

CREATE FUNCTION otl.community_pr_metadata_results(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
BEGIN
 IF coalesce(p->>'teamId','')='' THEN RAISE EXCEPTION 'team required'; END IF;
 IF p->>'operation'='ack' THEN
  UPDATE otl.po_pr_metadata_requests SET notified_revision=revision WHERE team_id=p->>'teamId'
   AND request_id=(p->>'requestId')::bigint AND revision=(p->>'revision')::integer;
  RETURN 'true'::jsonb;
 END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) FROM (
  SELECT request_id,work_key,pr_number,status,error_code,attempt,not_before,revision,head_sha FROM otl.po_pr_metadata_requests
  WHERE team_id=p->>'teamId' AND revision>notified_revision AND status IN('queued','draft','rejected','bound')
  ORDER BY request_id LIMIT 10) q);
END $$;

REVOKE ALL ON TABLE otl.po_pr_metadata_requests FROM PUBLIC,otl_bug_runner;
REVOKE ALL ON FUNCTION otl.community_queue_pr_metadata(jsonb),otl.community_pr_metadata_results(jsonb),
 otl.bug_runner_claim_pr_metadata(jsonb),otl.bug_runner_finish_pr_metadata(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION otl.bug_runner_claim_pr_metadata(jsonb),otl.bug_runner_finish_pr_metadata(jsonb) TO otl_bug_runner;
INSERT INTO otl.schema_migrations(version) VALUES('092-durable-pr-metadata');
COMMIT;
