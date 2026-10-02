BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:event-availability-grid:069',0));

ALTER TABLE otl.townhall_event_options DROP CONSTRAINT townhall_event_options_position_check;
ALTER TABLE otl.townhall_event_options ADD CONSTRAINT townhall_event_options_position_check
  CHECK(position BETWEEN 1 AND 336);
ALTER TABLE otl.townhall_events
  ADD COLUMN poll_start_date date,
  ADD COLUMN poll_end_date date,
  ADD COLUMN poll_day_start time,
  ADD COLUMN poll_day_end time,
  ADD COLUMN poll_step_minutes smallint CHECK(poll_step_minutes IN (30,60)),
  ADD COLUMN poll_timezone text CHECK(poll_timezone='Asia/Seoul'),
  ADD CONSTRAINT townhall_event_poll_shape CHECK(
    (poll_start_date IS NULL AND poll_end_date IS NULL AND poll_day_start IS NULL
      AND poll_day_end IS NULL AND poll_step_minutes IS NULL AND poll_timezone IS NULL)
    OR (poll_start_date IS NOT NULL AND poll_end_date IS NOT NULL AND poll_day_start IS NOT NULL
      AND poll_day_end IS NOT NULL AND poll_step_minutes IS NOT NULL AND poll_timezone IS NOT NULL
      AND poll_end_date>=poll_start_date AND poll_end_date-poll_start_date<=13
      AND poll_day_end>poll_day_start)
  );

CREATE OR REPLACE FUNCTION otl.townhall_event_json(e otl.townhall_events,actor text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,otl AS $$
  SELECT jsonb_build_object(
    'eventId',e.event_id,'teamId',e.team_id,'channelId',e.channel_id,
    'hostUserId',e.host_user_id,'activity',e.activity,'location',e.location,
    'revision',e.revision,'status',e.status,'messageTs',e.message_ts,
    'poll',CASE WHEN e.poll_start_date IS NULL THEN 'null'::jsonb ELSE jsonb_build_object(
      'startDate',e.poll_start_date,'endDate',e.poll_end_date,
      'dayStart',to_char(e.poll_day_start,'HH24:MI'),'dayEnd',to_char(e.poll_day_end,'HH24:MI'),
      'stepMinutes',e.poll_step_minutes,'timezone',e.poll_timezone) END,
    'options',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'startsAt',to_char(o.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'position',o.position,'votes',(SELECT count(*) FROM otl.townhall_event_availability a
        WHERE a.team_id=o.team_id AND a.channel_id=o.channel_id AND a.event_id=o.event_id
          AND a.starts_at=o.starts_at)) ORDER BY o.position)
      FROM otl.townhall_event_options o WHERE o.team_id=e.team_id AND o.channel_id=e.channel_id
        AND o.event_id=e.event_id),'[]'::jsonb),
    'selected',coalesce((SELECT jsonb_agg(to_char(a.starts_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS"Z"') ORDER BY o.position)
      FROM otl.townhall_event_availability a JOIN otl.townhall_event_options o
        USING(team_id,channel_id,event_id,starts_at)
      WHERE a.team_id=e.team_id AND a.channel_id=e.channel_id AND a.event_id=e.event_id
        AND a.user_id=actor),'[]'::jsonb))
$$;

CREATE FUNCTION otl.townhall_event_web_execute(op text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE
  t text:=p->>'teamId'; c text:=p->>'channelId'; actor text:=p->>'actorId';
  eid text:=p->>'eventId'; event_row otl.townhall_events;
  start_date date; end_date date; start_time time; end_time time; step_minutes integer;
  selected_count integer; requested_count integer;
BEGIN
  IF coalesce(t,'')='' OR coalesce(c,'')='' OR actor!~'^[UW][A-Z0-9]+$'
    OR eid!~'^V[A-Z0-9-]{1,80}$' THEN RAISE EXCEPTION 'invalid web event scope' USING ERRCODE='22023'; END IF;
  SELECT * INTO event_row FROM otl.townhall_events
    WHERE team_id=t AND channel_id=c AND event_id=eid FOR UPDATE;
  IF NOT FOUND OR event_row.status<>'active' THEN RETURN 'null'::jsonb; END IF;
  IF op='get' THEN RETURN otl.townhall_event_json(event_row,actor); END IF;
  IF op='configure' THEN
    IF event_row.host_user_id<>actor THEN RAISE EXCEPTION 'event host required' USING ERRCODE='42501'; END IF;
    start_date:=(p->>'startDate')::date; end_date:=(p->>'endDate')::date;
    start_time:=(p->>'dayStart')::time; end_time:=(p->>'dayEnd')::time;
    step_minutes:=(p->>'stepMinutes')::integer;
    IF end_date<start_date OR end_date-start_date>13 OR start_date<current_date
      OR start_time>=end_time OR step_minutes NOT IN (30,60)
    THEN RAISE EXCEPTION 'invalid event poll' USING ERRCODE='22023'; END IF;
    DELETE FROM otl.townhall_event_options o WHERE o.team_id=t AND o.channel_id=c AND o.event_id=eid
      AND NOT EXISTS(SELECT 1 FROM generate_series(start_date,end_date,interval '1 day') d(day)
        CROSS JOIN generate_series(start_date::timestamp+start_time,
          start_date::timestamp+end_time-make_interval(mins=>step_minutes),
          make_interval(mins=>step_minutes)) slot(value)
        WHERE ((d.day::date+slot.value::time) AT TIME ZONE 'Asia/Seoul')=o.starts_at);
    INSERT INTO otl.townhall_event_options(team_id,channel_id,event_id,starts_at,position)
      SELECT t,c,eid,(d.day::date+slot.value::time) AT TIME ZONE 'Asia/Seoul',
        row_number() OVER(ORDER BY d.day,slot.value)::smallint
      FROM generate_series(start_date,end_date,interval '1 day') d(day)
      CROSS JOIN generate_series(start_date::timestamp+start_time,
        start_date::timestamp+end_time-make_interval(mins=>step_minutes),
        make_interval(mins=>step_minutes)) slot(value)
      ON CONFLICT(team_id,channel_id,event_id,starts_at) DO UPDATE SET position=excluded.position;
    UPDATE otl.townhall_events SET poll_start_date=start_date,poll_end_date=end_date,
      poll_day_start=start_time,poll_day_end=end_time,poll_step_minutes=step_minutes,
      poll_timezone='Asia/Seoul',revision=revision+1,updated_at=transaction_timestamp()
      WHERE team_id=t AND channel_id=c AND event_id=eid RETURNING * INTO event_row;
    RETURN otl.townhall_event_json(event_row,actor);
  END IF;
  IF op='vote' THEN
    IF event_row.poll_start_date IS NULL OR jsonb_typeof(p->'selected') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p->'selected')>336 THEN RAISE EXCEPTION 'invalid web vote' USING ERRCODE='22023'; END IF;
    requested_count:=jsonb_array_length(p->'selected');
    IF (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p->'selected') x(value))<>requested_count
    THEN RAISE EXCEPTION 'duplicate web vote' USING ERRCODE='22023'; END IF;
    SELECT count(*) INTO selected_count FROM jsonb_array_elements_text(p->'selected') x(value)
      JOIN otl.townhall_event_options o ON o.team_id=t AND o.channel_id=c AND o.event_id=eid
        AND o.starts_at=x.value::timestamptz;
    IF selected_count<>requested_count THEN RAISE EXCEPTION 'unknown web option' USING ERRCODE='22023'; END IF;
    DELETE FROM otl.townhall_event_availability WHERE team_id=t AND channel_id=c
      AND event_id=eid AND user_id=actor;
    INSERT INTO otl.townhall_event_availability(team_id,channel_id,event_id,user_id,starts_at)
      SELECT t,c,eid,actor,value::timestamptz FROM jsonb_array_elements_text(p->'selected') x(value);
    RETURN otl.townhall_event_json(event_row,actor);
  END IF;
  RAISE EXCEPTION 'invalid web event operation' USING ERRCODE='22023';
END $$;

REVOKE ALL ON FUNCTION otl.townhall_event_web_execute(text,jsonb) FROM PUBLIC;
INSERT INTO otl.schema_migrations(version) VALUES('069-event-availability-grid');
COMMIT;
