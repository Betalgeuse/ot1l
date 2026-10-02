BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:event-series:071',0));

ALTER TABLE otl.townhall_events
  ADD COLUMN recurrence_every_weeks smallint CHECK(recurrence_every_weeks IN (1,2)),
  ADD COLUMN occurrence_count smallint CHECK(occurrence_count BETWEEN 2 AND 24),
  ADD CONSTRAINT townhall_event_series_config_check CHECK(
    (event_kind='series' AND recurrence_every_weeks IS NOT NULL AND occurrence_count IS NOT NULL)
    OR (event_kind<>'series' AND recurrence_every_weeks IS NULL AND occurrence_count IS NULL)
    OR (event_kind='series' AND recurrence_every_weeks IS NULL AND occurrence_count IS NULL)
  );

CREATE TABLE otl.townhall_event_occurrences (
  team_id text NOT NULL, channel_id text NOT NULL, event_id text NOT NULL,
  occurrence_number smallint NOT NULL CHECK(occurrence_number BETWEEN 1 AND 24),
  starts_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','completed','cancelled')),
  PRIMARY KEY(team_id,channel_id,event_id,occurrence_number),
  UNIQUE(team_id,channel_id,event_id,starts_at),
  FOREIGN KEY(team_id,channel_id,event_id)
    REFERENCES otl.townhall_events(team_id,channel_id,event_id) ON DELETE CASCADE
);

CREATE FUNCTION otl.townhall_event_series_execute(op text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE
  t text:=p->>'teamId'; c text:=p->>'channelId'; actor text:=p->>'actorId';
  eid text:=p->>'eventId'; event_row otl.townhall_events; every_weeks integer;
  total integer; result jsonb;
BEGIN
  IF actor!~'^[UW][A-Z0-9]+$' OR eid!~'^V[A-Z0-9-]{1,80}$'
  THEN RAISE EXCEPTION 'invalid event series actor'; END IF;
  SELECT * INTO event_row FROM otl.townhall_events
    WHERE team_id=t AND channel_id=c AND event_id=eid FOR UPDATE;
  IF NOT FOUND OR event_row.status<>'active' THEN RETURN 'null'::jsonb; END IF;
  IF op IN ('configure','finalize') AND event_row.host_user_id<>actor
  THEN RAISE EXCEPTION 'event host required'; END IF;
  IF op='configure' THEN
    IF event_row.event_kind='series' THEN
      every_weeks:=(p->>'recurrenceEveryWeeks')::integer;
      total:=(p->>'occurrenceCount')::integer;
      IF every_weeks NOT IN (1,2) OR total NOT BETWEEN 2 AND 24
      THEN RAISE EXCEPTION 'invalid event series recurrence'; END IF;
      UPDATE otl.townhall_events SET recurrence_every_weeks=every_weeks,
        occurrence_count=total,revision=revision+1,updated_at=transaction_timestamp()
        WHERE team_id=t AND channel_id=c AND event_id=eid RETURNING * INTO event_row;
    ELSE
      UPDATE otl.townhall_events SET recurrence_every_weeks=NULL,occurrence_count=NULL,
        revision=revision+1,updated_at=transaction_timestamp()
        WHERE team_id=t AND channel_id=c AND event_id=eid RETURNING * INTO event_row;
      DELETE FROM otl.townhall_event_occurrences WHERE team_id=t AND channel_id=c AND event_id=eid;
    END IF;
  ELSIF op='finalize' THEN
    IF event_row.final_start_at IS NULL THEN RAISE EXCEPTION 'final event time required'; END IF;
    DELETE FROM otl.townhall_event_occurrences WHERE team_id=t AND channel_id=c AND event_id=eid;
    IF event_row.event_kind='series' THEN
      IF event_row.recurrence_every_weeks IS NULL OR event_row.occurrence_count IS NULL
      THEN RAISE EXCEPTION 'series recurrence required'; END IF;
      INSERT INTO otl.townhall_event_occurrences(team_id,channel_id,event_id,occurrence_number,starts_at)
      SELECT t,c,eid,n::smallint,event_row.final_start_at
        + make_interval(weeks=>(n-1)*event_row.recurrence_every_weeks)
      FROM generate_series(1,event_row.occurrence_count) n;
    ELSE
      INSERT INTO otl.townhall_event_occurrences(team_id,channel_id,event_id,occurrence_number,starts_at)
      VALUES(t,c,eid,1,event_row.final_start_at);
    END IF;
  ELSIF op<>'get' THEN RAISE EXCEPTION 'invalid event series operation'; END IF;
  SELECT otl.townhall_event_json(event_row,actor) || jsonb_build_object(
    'series',CASE WHEN event_row.event_kind<>'series' THEN 'null'::jsonb ELSE jsonb_build_object(
      'recurrenceEveryWeeks',event_row.recurrence_every_weeks,
      'occurrenceCount',event_row.occurrence_count,
      'occurrences',coalesce((SELECT jsonb_agg(jsonb_build_object(
        'number',o.occurrence_number,
        'startsAt',to_char(o.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'status',o.status) ORDER BY o.occurrence_number)
        FROM otl.townhall_event_occurrences o WHERE o.team_id=t AND o.channel_id=c
          AND o.event_id=eid),'[]'::jsonb)) END) INTO result;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION otl.townhall_event_series_execute(text,jsonb) FROM PUBLIC;
INSERT INTO otl.schema_migrations(version) VALUES('071-event-series');
COMMIT;
