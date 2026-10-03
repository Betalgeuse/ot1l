BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:event-poll-auto-confirm:074',0));

CREATE FUNCTION otl.townhall_event_confirm_selected_slot() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
BEGIN
  IF NEW.final_start_at IS NOT NULL AND NEW.final_start_at IS DISTINCT FROM OLD.final_start_at THEN
    INSERT INTO otl.townhall_event_participants(team_id,channel_id,event_id,user_id,state,source)
    SELECT a.team_id,a.channel_id,a.event_id,a.user_id,'going','web'
    FROM otl.townhall_event_availability a
    WHERE a.team_id=NEW.team_id AND a.channel_id=NEW.channel_id
      AND a.event_id=NEW.event_id AND a.starts_at=NEW.final_start_at
    ON CONFLICT(team_id,channel_id,event_id,user_id) DO UPDATE SET
      state='going',source='web',updated_at=transaction_timestamp();
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER townhall_event_confirm_selected_slot_after_update
AFTER UPDATE OF final_start_at ON otl.townhall_events FOR EACH ROW
EXECUTE FUNCTION otl.townhall_event_confirm_selected_slot();

REVOKE ALL ON FUNCTION otl.townhall_event_confirm_selected_slot() FROM PUBLIC;
INSERT INTO otl.schema_migrations(version) VALUES('074-event-poll-auto-confirm');
COMMIT;
