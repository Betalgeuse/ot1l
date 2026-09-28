BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE FUNCTION otl.claim_common_delivery_v2(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE rec otl.community_records; at_time timestamptz:=(p->>'now')::timestamptz;
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
  UPDATE otl.community_records SET status='claimed',reminder_attempts=reminder_attempts+1,
    reminder_first_attempt_at=coalesce(reminder_first_attempt_at,at_time),
    reminder_lease_token=p->>'leaseToken',reminder_lease_expires_at=at_time+interval '60 seconds',
    reminder_retry_after=NULL,updated_at=at_time
  WHERE team_id=rec.team_id AND channel_id=rec.channel_id AND user_id=rec.user_id
    AND record_key=rec.record_key;
  RETURN jsonb_build_object('leaseToken',p->>'leaseToken','attempt',rec.reminder_attempts+1,
    'firstAttemptAt',coalesce(rec.reminder_first_attempt_at,at_time),'key',rec.record_key,
    'text',rec.body->>'text','date',rec.body->>'date','kind',rec.body->>'kind');
END $$;

REVOKE ALL ON FUNCTION otl.claim_common_delivery_v2(jsonb) FROM PUBLIC;

INSERT INTO otl.schema_migrations(version) VALUES('057-common-delivery-short-lease');
COMMIT;
