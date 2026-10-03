BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:event-review-followup:076',0));

CREATE TABLE otl.townhall_event_followups (
  team_id text NOT NULL, channel_id text NOT NULL, event_id text NOT NULL,
  scheduled_message_id text NOT NULL, post_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(team_id,channel_id,event_id),
  FOREIGN KEY(team_id,channel_id,event_id)
    REFERENCES otl.townhall_events(team_id,channel_id,event_id) ON DELETE CASCADE
);

CREATE FUNCTION otl.townhall_event_followup_execute(op text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE result jsonb;
BEGIN
  IF op='get' THEN
    SELECT jsonb_build_object('scheduledMessageId',f.scheduled_message_id,'postAt',f.post_at)
    INTO result FROM otl.townhall_event_followups f
    WHERE f.team_id=p->>'teamId' AND f.channel_id=p->>'channelId' AND f.event_id=p->>'eventId';
    RETURN coalesce(result,'null'::jsonb);
  END IF;
  IF op='put' THEN
    IF NOT EXISTS(SELECT 1 FROM otl.townhall_events e WHERE e.team_id=p->>'teamId'
      AND e.channel_id=p->>'channelId' AND e.event_id=p->>'eventId'
      AND e.host_user_id=p->>'actorId') THEN RAISE EXCEPTION 'event host required'; END IF;
    INSERT INTO otl.townhall_event_followups(team_id,channel_id,event_id,scheduled_message_id,post_at)
    VALUES(p->>'teamId',p->>'channelId',p->>'eventId',p->>'scheduledMessageId',(p->>'postAt')::timestamptz)
    ON CONFLICT(team_id,channel_id,event_id) DO UPDATE SET
      scheduled_message_id=excluded.scheduled_message_id,post_at=excluded.post_at,
      updated_at=transaction_timestamp();
    RETURN 'true'::jsonb;
  END IF;
  RAISE EXCEPTION 'invalid event followup operation';
END $$;

REVOKE ALL ON FUNCTION otl.townhall_event_followup_execute(text,jsonb) FROM PUBLIC;
INSERT INTO otl.schema_migrations(version) VALUES('076-event-review-followup');
COMMIT;
