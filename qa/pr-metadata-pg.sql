\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database()<>'postgres' OR inet_server_addr() IS NOT NULL THEN RAISE EXCEPTION 'isolated local socket database required';END IF;END $$;
CREATE SCHEMA otl;
CREATE ROLE otl_bug_runner;
CREATE TABLE otl.schema_migrations(version text PRIMARY KEY);
CREATE TABLE otl.bug_reports(bug_id text PRIMARY KEY);
CREATE TABLE otl.community_maintainers(team_id text,user_id text,state text);
CREATE TABLE otl.maintainer_feedback_work(team_id text,work_key text,pr_number bigint);
CREATE TABLE otl.bug_jobs(bug_id text,status text);
CREATE FUNCTION otl.community_bind_pull_request(jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"accepted":true}'::jsonb $$;
\i migrations/092_durable_pr_metadata.sql
INSERT INTO otl.bug_reports VALUES('BUG-PRLOOKUP001'),('BUG-PRLOOKUP002');
INSERT INTO otl.community_maintainers VALUES('TQA','UPO','active');
INSERT INTO otl.maintainer_feedback_work VALUES('TQA','BUG-PRLOOKUP001',145),('TQA','BUG-PRLOOKUP002',146);
DO $$
DECLARE p jsonb:='{"teamId":"TQA","actorId":"UPO","founderId":"UFOUNDER","workKey":"BUG-PRLOOKUP001","prNumber":145}';r jsonb;again jsonb;identity jsonb;
BEGIN
 BEGIN PERFORM otl.community_queue_pr_metadata(p||'{"actorId":"UOTHER"}');RAISE EXCEPTION 'unauthorized accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 r:=otl.community_queue_pr_metadata(p);again:=otl.community_queue_pr_metadata(p);
 IF r->>'requestId'<>again->>'requestId' OR (SELECT count(*) FROM otl.po_pr_metadata_requests)<>1 THEN RAISE EXCEPTION 'duplicate request';END IF;
 r:=otl.bug_runner_claim_pr_metadata('{"teamId":"TQA","workerId":"qa","leaseToken":"lease1"}');
 IF otl.bug_runner_claim_pr_metadata('{"teamId":"TQA","workerId":"other","leaseToken":"lease2"}')<>'null'::jsonb THEN RAISE EXCEPTION 'double claim';END IF;
 identity:=jsonb_build_object('teamId','TQA','requestId',r->'request_id','workerId','qa','leaseToken','lease1');
 BEGIN PERFORM otl.bug_runner_finish_pr_metadata(identity||'{"leaseToken":"wrong","outcome":"draft"}');RAISE EXCEPTION 'wrong lease accepted';EXCEPTION WHEN serialization_failure THEN NULL;END;
 PERFORM otl.bug_runner_finish_pr_metadata(identity||'{"outcome":"failed","errorCode":"github_rate_limited","retryable":true,"retryAfterSeconds":3600}');
 IF NOT EXISTS(SELECT 1 FROM otl.po_pr_metadata_requests WHERE status='queued' AND error_code='github_rate_limited' AND not_before>now()+interval '59 minutes')THEN RAISE EXCEPTION 'backoff missing';END IF;
 IF otl.bug_runner_claim_pr_metadata('{"teamId":"TQA","workerId":"qa","leaseToken":"lease3"}')<>'null'::jsonb THEN RAISE EXCEPTION 'retry too early';END IF;
 UPDATE otl.po_pr_metadata_requests SET not_before=now()-interval '1 second';
 r:=otl.bug_runner_claim_pr_metadata('{"teamId":"TQA","workerId":"qa","leaseToken":"lease4"}');
 PERFORM otl.bug_runner_finish_pr_metadata(identity||'{"leaseToken":"lease4","outcome":"draft"}');
 IF (SELECT status FROM otl.po_pr_metadata_requests)<>'draft' THEN RAISE EXCEPTION 'draft not isolated';END IF;
 PERFORM otl.community_queue_pr_metadata(p);
 r:=otl.bug_runner_claim_pr_metadata('{"teamId":"TQA","workerId":"qa","leaseToken":"lease5"}');
 UPDATE otl.community_maintainers SET state='revoked';
 PERFORM otl.bug_runner_finish_pr_metadata(identity||'{"leaseToken":"lease5","outcome":"ready","metadata":{}}');
 IF (SELECT error_code FROM otl.po_pr_metadata_requests)<>'actor_inactive' THEN RAISE EXCEPTION 'revoked actor not rejected';END IF;
 UPDATE otl.community_maintainers SET state='active';
 PERFORM otl.community_queue_pr_metadata(p);
 PERFORM otl.bug_runner_claim_pr_metadata('{"teamId":"TQA","workerId":"qa","leaseToken":"lease6"}');
 UPDATE otl.po_pr_metadata_requests SET attempt=3,lease_expires_at=now()-interval '1 second';
 PERFORM otl.bug_runner_claim_pr_metadata('{"teamId":"TQA","workerId":"qa","leaseToken":"lease7"}');
 IF (SELECT status FROM otl.po_pr_metadata_requests)<>'rejected' THEN RAISE EXCEPTION 'exhausted lease not terminal';END IF;
 IF jsonb_array_length(otl.community_pr_metadata_results('{"teamId":"OTHER"}'))<>0 THEN RAISE EXCEPTION 'cross-team results';END IF;
END $$;
SELECT 'PASS durable metadata SQL: identity, duplicate, lease, backoff, draft, revocation, exhausted retry, tenant isolation';
