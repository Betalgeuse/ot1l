BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:event-host-duration:072',0));

ALTER TABLE otl.townhall_events
  ADD COLUMN duration_minutes smallint NOT NULL DEFAULT 60
    CHECK(duration_minutes BETWEEN 30 AND 720 AND duration_minutes % 30 = 0);

CREATE FUNCTION otl.townhall_event_host_participant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
BEGIN
  INSERT INTO otl.townhall_event_participants(
    team_id,channel_id,event_id,user_id,state,source
  ) VALUES(NEW.team_id,NEW.channel_id,NEW.event_id,NEW.host_user_id,'going','host')
  ON CONFLICT(team_id,channel_id,event_id,user_id) DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER townhall_event_host_participant_after_insert
AFTER INSERT ON otl.townhall_events FOR EACH ROW
EXECUTE FUNCTION otl.townhall_event_host_participant();

INSERT INTO otl.townhall_event_participants(team_id,channel_id,event_id,user_id,state,source)
SELECT team_id,channel_id,event_id,host_user_id,'going','host'
FROM otl.townhall_events
WHERE status IN ('draft','active')
ON CONFLICT(team_id,channel_id,event_id,user_id) DO NOTHING;

CREATE FUNCTION otl.townhall_event_enriched_json(e otl.townhall_events,actor text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,otl AS $$
  SELECT otl.townhall_event_json(e,actor) || jsonb_build_object(
    'durationMinutes',e.duration_minutes,
    'finalEndAt',CASE WHEN e.final_start_at IS NULL THEN NULL ELSE
      to_char((e.final_start_at+make_interval(mins=>e.duration_minutes)) AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS"Z"') END,
    'series',CASE WHEN e.event_kind<>'series' THEN 'null'::jsonb ELSE jsonb_build_object(
      'recurrenceEveryWeeks',e.recurrence_every_weeks,
      'occurrenceCount',e.occurrence_count,
      'occurrences',coalesce((SELECT jsonb_agg(jsonb_build_object(
        'number',o.occurrence_number,
        'startsAt',to_char(o.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'status',o.status) ORDER BY o.occurrence_number)
        FROM otl.townhall_event_occurrences o WHERE o.team_id=e.team_id
          AND o.channel_id=e.channel_id AND o.event_id=e.event_id),'[]'::jsonb)) END)
$$;

CREATE OR REPLACE FUNCTION otl.townhall_event_series_execute(op text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE
  t text:=p->>'teamId'; c text:=p->>'channelId'; actor text:=p->>'actorId';
  eid text:=p->>'eventId'; event_row otl.townhall_events; every_weeks integer;
  total integer; duration integer; result jsonb;
BEGIN
  IF actor!~'^[UW][A-Z0-9]+$' OR eid!~'^V[A-Z0-9-]{1,80}$'
  THEN RAISE EXCEPTION 'invalid event series actor'; END IF;
  SELECT * INTO event_row FROM otl.townhall_events
    WHERE team_id=t AND channel_id=c AND event_id=eid FOR UPDATE;
  IF NOT FOUND OR event_row.status<>'active' THEN RETURN 'null'::jsonb; END IF;
  IF op IN ('configure','finalize') AND event_row.host_user_id<>actor
  THEN RAISE EXCEPTION 'event host required'; END IF;
  IF op='configure' THEN
    duration:=(p->>'durationMinutes')::integer;
    IF duration NOT BETWEEN 30 AND 720 OR duration % 30<>0
    THEN RAISE EXCEPTION 'invalid event duration'; END IF;
    IF event_row.event_kind='series' THEN
      every_weeks:=(p->>'recurrenceEveryWeeks')::integer;
      total:=(p->>'occurrenceCount')::integer;
      IF every_weeks NOT IN (1,2) OR total NOT BETWEEN 2 AND 24
      THEN RAISE EXCEPTION 'invalid event series recurrence'; END IF;
      UPDATE otl.townhall_events SET recurrence_every_weeks=every_weeks,
        occurrence_count=total,duration_minutes=duration,revision=revision+1,
        updated_at=transaction_timestamp()
        WHERE team_id=t AND channel_id=c AND event_id=eid RETURNING * INTO event_row;
    ELSE
      UPDATE otl.townhall_events SET recurrence_every_weeks=NULL,occurrence_count=NULL,
        duration_minutes=duration,revision=revision+1,updated_at=transaction_timestamp()
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
  SELECT otl.townhall_event_enriched_json(event_row,actor) INTO result;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION otl.townhall_event_host_participant(),
  otl.townhall_event_enriched_json(otl.townhall_events,text) FROM PUBLIC;
INSERT INTO otl.schema_migrations(version) VALUES('072-event-host-duration');
COMMIT;
