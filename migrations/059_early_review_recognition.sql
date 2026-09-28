BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:early-review-recognition:059',0));

ALTER FUNCTION otl.community_execute(text,jsonb)
  RENAME TO community_execute_before_early_review_recognition;
REVOKE EXECUTE ON FUNCTION otl.community_execute_before_early_review_recognition(text,jsonb) FROM PUBLIC;

CREATE FUNCTION otl.community_execute(op text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,otl AS $$
DECLARE
  t text:=p->>'teamId'; c text:=p->>'channelId'; u text:=p->>'userId';
  target_day date; root text; root_record otl.community_records; dispatch otl.community_records;
BEGIN
  IF op<>'bind_review_root' THEN
    RETURN otl.community_execute_before_early_review_recognition(op,p);
  END IF;
  IF coalesce(t,'')='' OR coalesce(c,'')='' OR coalesce(u,'')='' THEN
    RAISE EXCEPTION 'scope required';
  END IF;
  target_day:=(p->>'date')::date;
  root:=p->>'messageTs';
  IF root!~'^\d{1,16}\.\d{1,12}$' THEN RAISE EXCEPTION 'invalid review root'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array(t,c,target_day)::text,31));

  SELECT * INTO root_record FROM otl.community_records
   WHERE team_id=t AND channel_id=c AND kind='prompt'
     AND record_key='common-thread:'||target_day::text||':review';
  SELECT * INTO dispatch FROM otl.community_records
   WHERE team_id=t AND channel_id=c AND kind='dispatch'
     AND record_key='common:'||target_day::text||':review';
  IF root_record.body->>'date' IS DISTINCT FROM target_day::text
    OR root_record.body->>'kind' IS DISTINCT FROM 'review'
    OR root_record.body->>'ts' IS DISTINCT FROM root
    OR dispatch.status IS DISTINCT FROM 'sent'
    OR dispatch.body->>'date' IS DISTINCT FROM target_day::text
    OR dispatch.body->>'kind' IS DISTINCT FROM 'review'
    OR dispatch.body->>'messageTs' IS DISTINCT FROM root
  THEN RAISE EXCEPTION 'exact sent review root required'; END IF;

  INSERT INTO otl.community_review_roots(team_id,channel_id,day,root_key,thread_ts,bound_by_user_id)
   VALUES(t,c,target_day,'common-thread:'||target_day::text||':review',root,u)
   ON CONFLICT(team_id,channel_id,day) DO NOTHING;
  IF EXISTS(SELECT 1 FROM otl.community_review_roots x
    WHERE x.team_id=t AND x.channel_id=c AND x.day=target_day AND x.thread_ts<>root)
  THEN RAISE EXCEPTION 'review root already bound'; END IF;

  UPDATE otl.community_garden_deliveries SET status='cancelled',worker_id=NULL,lease_token=NULL,
    lease_expires_at=NULL,retry_after=NULL,updated_at=transaction_timestamp()
   WHERE team_id=t AND channel_id=c AND day=target_day AND status IN ('pending','claimed','failed')
     AND (thread_ts<>root OR route_provenance='canonical_review');

  RETURN jsonb_build_object('date',target_day,'threadTs',root,'enqueued',0);
END $$;
REVOKE ALL ON FUNCTION otl.community_execute(text,jsonb) FROM PUBLIC;

UPDATE otl.community_garden_deliveries SET status='cancelled',worker_id=NULL,lease_token=NULL,
  lease_expires_at=NULL,retry_after=NULL,updated_at=transaction_timestamp()
 WHERE route_provenance='canonical_review' AND status IN ('pending','claimed','failed');

INSERT INTO otl.schema_migrations(version) VALUES('059-early-review-recognition');
COMMIT;
