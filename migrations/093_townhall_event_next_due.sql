BEGIN;
CREATE INDEX townhall_event_recruitment_due_idx
  ON otl.townhall_events(team_id,channel_id,recruitment_deadline)
  WHERE status='active' AND auto_cancel
    AND phase IN ('recruiting','scheduling','scheduled');
CREATE INDEX townhall_event_cancel_due_idx
  ON otl.townhall_events(team_id,channel_id,grace_until)
  WHERE status='active' AND auto_cancel AND phase='cancel_pending';
CREATE FUNCTION otl.townhall_event_next_due(t text,c text,after_time timestamptz)
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
  SELECT min(due_at) FROM (
    SELECT e.recruitment_deadline AS due_at FROM otl.townhall_events e
    WHERE e.team_id=t AND e.channel_id=c AND e.status='active' AND e.auto_cancel
      AND e.phase IN ('recruiting','scheduling','scheduled')
      AND e.recruitment_deadline>after_time
    UNION ALL
    SELECT e.grace_until AS due_at FROM otl.townhall_events e
    WHERE e.team_id=t AND e.channel_id=c AND e.status='active' AND e.auto_cancel
      AND e.phase='cancel_pending' AND e.grace_until>after_time
  ) due
$$;
REVOKE ALL ON FUNCTION otl.townhall_event_next_due(text,text,timestamptz) FROM PUBLIC;
INSERT INTO otl.schema_migrations(version) VALUES('093-townhall-event-next-due');
COMMIT;
