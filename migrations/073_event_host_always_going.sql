BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:event-host-always-going:073',0));

CREATE FUNCTION otl.townhall_event_force_host_going() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
BEGIN
  IF EXISTS(
    SELECT 1 FROM otl.townhall_events e
    WHERE e.team_id=NEW.team_id AND e.channel_id=NEW.channel_id
      AND e.event_id=NEW.event_id AND e.host_user_id=NEW.user_id
  ) THEN
    NEW.state:='going';
    NEW.source:='host';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER townhall_event_force_host_going_before_write
BEFORE INSERT OR UPDATE ON otl.townhall_event_participants FOR EACH ROW
EXECUTE FUNCTION otl.townhall_event_force_host_going();

UPDATE otl.townhall_event_participants p SET state='going',source='host',
  updated_at=transaction_timestamp()
FROM otl.townhall_events e
WHERE e.team_id=p.team_id AND e.channel_id=p.channel_id AND e.event_id=p.event_id
  AND e.host_user_id=p.user_id AND (p.state<>'going' OR p.source<>'host');

REVOKE ALL ON FUNCTION otl.townhall_event_force_host_going() FROM PUBLIC;
INSERT INTO otl.schema_migrations(version) VALUES('073-event-host-always-going');
COMMIT;
