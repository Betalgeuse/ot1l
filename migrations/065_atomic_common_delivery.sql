BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:atomic-common-delivery:065',0));

CREATE OR REPLACE FUNCTION otl.claim_common_delivery_v2(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE
  rec otl.community_records;
  at_time timestamptz:=(p->>'now')::timestamptz;
  safe_to_post boolean;
BEGIN
  IF coalesce(p->>'teamId','')='' OR coalesce(p->>'channelId','')=''
     OR coalesce(p->>'userId','')='' OR coalesce(p->>'leaseToken','')=''
  THEN RAISE EXCEPTION 'common lease required' USING ERRCODE='22023'; END IF;
  SELECT * INTO rec FROM otl.community_records r
  WHERE r.team_id=p->>'teamId' AND r.channel_id=p->>'channelId' AND r.user_id=p->>'userId'
    AND r.kind='dispatch' AND r.status IN ('pending','failed','claimed') AND r.reminder_attempts<3
    AND (r.status='pending'
      OR (r.status='failed' AND coalesce(r.reminder_retry_after,'-infinity')<=at_time)
      OR (r.status='claimed' AND r.reminder_lease_expires_at<=at_time))
  ORDER BY r.updated_at,r.record_key LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN 'null'::jsonb; END IF;
  safe_to_post:=rec.status='pending'
    OR (rec.status='failed' AND rec.reminder_last_error_code='rate_limited');
  UPDATE otl.community_records SET status='claimed',reminder_attempts=reminder_attempts+1,
    reminder_first_attempt_at=coalesce(reminder_first_attempt_at,at_time),
    reminder_lease_token=p->>'leaseToken',reminder_lease_expires_at=at_time+interval '60 seconds',
    reminder_retry_after=NULL,updated_at=at_time
  WHERE team_id=rec.team_id AND channel_id=rec.channel_id AND user_id=rec.user_id
    AND record_key=rec.record_key;
  RETURN jsonb_build_object('leaseToken',p->>'leaseToken','attempt',rec.reminder_attempts+1,
    'safeToPost',safe_to_post,
    'firstAttemptAt',coalesce(rec.reminder_first_attempt_at,at_time),'key',rec.record_key,
    'text',rec.body->>'text','date',rec.body->>'date','kind',rec.body->>'kind');
END $$;

CREATE FUNCTION otl.finish_common_root(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE
  t text:=p->>'teamId'; c text:=p->>'channelId'; u text:=p->>'userId';
  lease text:=p->>'leaseToken'; target_day date:=(p->>'date')::date;
  delivery_kind text:=p->>'kind'; message_ts text:=p->>'messageTs';
  dispatch otl.community_records; prompt otl.community_records; root otl.community_records;
  affected integer;
BEGIN
  IF coalesce(t,'')='' OR coalesce(c,'')='' OR coalesce(u,'')='' OR coalesce(lease,'')=''
    OR delivery_kind NOT IN ('goal','review')
    OR message_ts!~'^\d{1,16}\.\d{1,12}$'
  THEN RAISE EXCEPTION 'invalid common root receipt' USING ERRCODE='22023'; END IF;
  SELECT * INTO dispatch FROM otl.community_records r
   WHERE r.team_id=t AND r.channel_id=c AND r.user_id=u
     AND r.record_key='common:'||target_day::text||':'||delivery_kind
     AND r.kind='dispatch' FOR UPDATE;
  IF NOT FOUND OR dispatch.status<>'claimed' OR dispatch.reminder_lease_token<>lease
    OR dispatch.body->>'date' IS DISTINCT FROM target_day::text
    OR dispatch.body->>'kind' IS DISTINCT FROM delivery_kind
  THEN RETURN 'false'::jsonb; END IF;

  UPDATE otl.community_records SET status='sent',
    body=body||jsonb_build_object('messageTs',message_ts),
    reminder_lease_token=NULL,reminder_lease_expires_at=NULL,reminder_retry_after=NULL,
    reminder_last_error_code=NULL,updated_at=transaction_timestamp()
   WHERE team_id=t AND channel_id=c AND user_id=u AND record_key=dispatch.record_key
     AND status='claimed' AND reminder_lease_token=lease;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RETURN 'false'::jsonb; END IF;

  INSERT INTO otl.community_records(team_id,channel_id,user_id,record_key,kind,body)
   VALUES(t,c,u,'prompt:'||message_ts,'prompt',
     jsonb_build_object('date',target_day,'kind',delivery_kind))
   ON CONFLICT DO NOTHING;
  INSERT INTO otl.community_records(team_id,channel_id,user_id,record_key,kind,body)
   VALUES(t,c,u,'common-thread:'||target_day::text||':'||delivery_kind,'prompt',
     jsonb_build_object('date',target_day,'kind',delivery_kind,'ts',message_ts))
   ON CONFLICT DO NOTHING;

  SELECT * INTO prompt FROM otl.community_records r
   WHERE r.team_id=t AND r.channel_id=c AND r.user_id=u AND r.record_key='prompt:'||message_ts;
  SELECT * INTO root FROM otl.community_records r
   WHERE r.team_id=t AND r.channel_id=c AND r.user_id=u
     AND r.record_key='common-thread:'||target_day::text||':'||delivery_kind;
  IF prompt.kind IS DISTINCT FROM 'prompt' OR prompt.body->>'date' IS DISTINCT FROM target_day::text
    OR prompt.body->>'kind' IS DISTINCT FROM delivery_kind
    OR root.kind IS DISTINCT FROM 'prompt' OR root.body->>'date' IS DISTINCT FROM target_day::text
    OR root.body->>'kind' IS DISTINCT FROM delivery_kind
    OR root.body->>'ts' IS DISTINCT FROM message_ts
  THEN RAISE EXCEPTION 'common root receipt conflict' USING ERRCODE='40001'; END IF;

  IF delivery_kind='review' AND coalesce((p->>'bindReview')::boolean,false) THEN
    PERFORM otl.community_execute('bind_review_root',jsonb_build_object(
      'teamId',t,'channelId',c,'userId',u,'date',target_day,'messageTs',message_ts));
  END IF;
  RETURN 'true'::jsonb;
END $$;

REVOKE ALL ON FUNCTION otl.claim_common_delivery_v2(jsonb),otl.finish_common_root(jsonb) FROM PUBLIC;

INSERT INTO otl.schema_migrations(version) VALUES('065-atomic-common-delivery');
COMMIT;
