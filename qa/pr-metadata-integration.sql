\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database()<>'otl_pr_metadata_full' OR inet_server_addr() IS NOT NULL THEN RAISE EXCEPTION 'isolated local integration database required';END IF;END $$;
BEGIN;
INSERT INTO otl.bug_reports(bug_id,team_id,public_alias,reporter_id,source,source_opaque_ref,source_channel_id,source_thread,title)
VALUES('BUG-PRMETADATAFULL01','TPRMETA','B-PRMETADATAFULL01','UFOUNDER','slack','slack:TPRMETA:CPO:1.000001','CPO','1.000001','PR metadata QA');
INSERT INTO otl.maintainer_feedback_work(team_id,work_key,reporter_id,desired_dri,dri_user_id,title,actual,expected,source_channel,source_thread,pr_number,pr_url)
VALUES('TPRMETA','BUG-PRMETADATAFULL01','UFOUNDER','UFOUNDER','UFOUNDER','PR QA','Request PR review','Verify PR','CPO','1.000001',145,'https://github.com/Betalgeuse/ot1l/pull/145');
DO $$
DECLARE r jsonb; result jsonb;
BEGIN
 PERFORM otl.community_queue_pr_metadata('{"teamId":"TPRMETA","actorId":"UFOUNDER","founderId":"UFOUNDER","workKey":"BUG-PRMETADATAFULL01","prNumber":145}');
 r:=otl.bug_runner_claim_pr_metadata('{"teamId":"TPRMETA","workerId":"qa","leaseToken":"full-lease"}');
 result:=otl.bug_runner_finish_pr_metadata(jsonb_build_object('teamId','TPRMETA','requestId',r->'request_id','workerId','qa','leaseToken','full-lease','outcome','ready',
  'metadata',jsonb_build_object('headSha',repeat('a',40),'headRepository','contributor/ot1l','title','Validated PR title','paths',jsonb_build_array('docs/README.md'),'pathsDigest',repeat('b',64))));
 IF result->>'status'<>'bound' THEN RAISE EXCEPTION 'binding not accepted: %',result;END IF;
 IF NOT EXISTS(SELECT 1 FROM otl.po_work_pull_requests WHERE work_key='BUG-PRMETADATAFULL01' AND head_sha=repeat('a',40) AND status='queued')THEN RAISE EXCEPTION 'exact SHA verifier not enqueued';END IF;
 IF EXISTS(SELECT 1 FROM otl.git_changes WHERE bug_id='BUG-PRMETADATAFULL01')THEN RAISE EXCEPTION 'metadata lookup must not create merge approval';END IF;
 IF (SELECT state FROM otl.bug_reports WHERE bug_id='BUG-PRMETADATAFULL01')<>'reviewing' THEN RAISE EXCEPTION 'work did not enter reviewing';END IF;
END $$;
ROLLBACK;
SELECT 'PASS real 092 -> 090 binding -> exact-SHA verification queue, with no merge approval';
