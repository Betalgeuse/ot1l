BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:townhall-event-poll:066',0));

CREATE TABLE otl.townhall_events (
  team_id text NOT NULL,
  channel_id text NOT NULL,
  event_id text NOT NULL CHECK(event_id~'^V[A-Z0-9-]{1,80}$'),
  host_user_id text NOT NULL CHECK(host_user_id~'^[UW][A-Z0-9]+$'),
  activity text NOT NULL CHECK(length(btrim(activity)) BETWEEN 1 AND 500),
  location text NOT NULL CHECK(length(btrim(location)) BETWEEN 1 AND 120),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active')),
  message_ts text,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(team_id,channel_id,event_id),
  UNIQUE(team_id,channel_id,message_ts),
  CHECK((status='draft' AND message_ts IS NULL) OR
    (status='active' AND message_ts~'^\d{1,16}\.\d{1,12}$'))
);

CREATE TABLE otl.townhall_event_options (
  team_id text NOT NULL,
  channel_id text NOT NULL,
  event_id text NOT NULL,
  starts_at timestamptz NOT NULL,
  position smallint NOT NULL CHECK(position BETWEEN 1 AND 8),
  PRIMARY KEY(team_id,channel_id,event_id,starts_at),
  FOREIGN KEY(team_id,channel_id,event_id)
    REFERENCES otl.townhall_events(team_id,channel_id,event_id) ON DELETE CASCADE
);

CREATE TABLE otl.townhall_event_availability (
  team_id text NOT NULL,
  channel_id text NOT NULL,
  event_id text NOT NULL,
  user_id text NOT NULL CHECK(user_id~'^[UW][A-Z0-9]+$'),
  starts_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(team_id,channel_id,event_id,user_id,starts_at),
  FOREIGN KEY(team_id,channel_id,event_id,starts_at)
    REFERENCES otl.townhall_event_options(team_id,channel_id,event_id,starts_at) ON DELETE CASCADE
);

CREATE FUNCTION otl.townhall_event_json(e otl.townhall_events,actor text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,otl AS $$
  SELECT jsonb_build_object(
    'eventId',e.event_id,'teamId',e.team_id,'channelId',e.channel_id,
    'hostUserId',e.host_user_id,'activity',e.activity,'location',e.location,
    'revision',e.revision,'status',e.status,'messageTs',e.message_ts,
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

CREATE FUNCTION otl.townhall_event_execute(op text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE
  t text:=p->>'teamId'; c text:=p->>'channelId'; actor text:=p->>'actorId';
  eid text:=p->>'eventId'; event_row otl.townhall_events; created boolean:=false;
  selected_count integer; requested_count integer;
BEGIN
  IF coalesce(t,'')='' OR coalesce(c,'')='' OR actor!~'^[UW][A-Z0-9]+$'
    OR eid!~'^V[A-Z0-9-]{1,80}$' THEN
    RAISE EXCEPTION 'invalid townhall event scope' USING ERRCODE='22023';
  END IF;

  IF op='create' THEN
    IF length(btrim(coalesce(p->>'activity',''))) NOT BETWEEN 1 AND 500
      OR length(btrim(coalesce(p->>'location',''))) NOT BETWEEN 1 AND 120
      OR jsonb_typeof(p->'options') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p->'options') NOT BETWEEN 1 AND 8
    THEN RAISE EXCEPTION 'invalid townhall event' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p->'options') x(value)
      WHERE value::timestamptz<=transaction_timestamp()-interval '1 minute')
      OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p->'options') x(value))
        <>jsonb_array_length(p->'options')
    THEN RAISE EXCEPTION 'invalid townhall event options' USING ERRCODE='22023'; END IF;
    INSERT INTO otl.townhall_events(team_id,channel_id,event_id,host_user_id,activity,location)
      VALUES(t,c,eid,actor,btrim(p->>'activity'),btrim(p->>'location')) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS selected_count=ROW_COUNT; created:=selected_count=1;
    SELECT * INTO event_row FROM otl.townhall_events
      WHERE team_id=t AND channel_id=c AND event_id=eid FOR UPDATE;
    IF event_row.host_user_id<>actor THEN RAISE EXCEPTION 'event owner mismatch' USING ERRCODE='42501'; END IF;
    IF created THEN
      INSERT INTO otl.townhall_event_options(team_id,channel_id,event_id,starts_at,position)
        SELECT t,c,eid,value::timestamptz,ordinality::smallint
        FROM jsonb_array_elements_text(p->'options') WITH ORDINALITY x(value,ordinality);
    END IF;
    RETURN jsonb_build_object('created',created,'event',otl.townhall_event_json(event_row,actor));
  END IF;

  SELECT * INTO event_row FROM otl.townhall_events
    WHERE team_id=t AND channel_id=c AND event_id=eid FOR UPDATE;
  IF NOT FOUND THEN RETURN 'null'::jsonb; END IF;
  IF op='get' THEN RETURN otl.townhall_event_json(event_row,actor); END IF;
  IF op='bind' THEN
    IF event_row.host_user_id<>actor OR coalesce(p->>'messageTs','')!~'^\d{1,16}\.\d{1,12}$'
      THEN RAISE EXCEPTION 'invalid event bind' USING ERRCODE='42501'; END IF;
    IF event_row.status='active' THEN RETURN to_jsonb(event_row.message_ts=p->>'messageTs'); END IF;
    UPDATE otl.townhall_events SET status='active',message_ts=p->>'messageTs',updated_at=transaction_timestamp()
      WHERE team_id=t AND channel_id=c AND event_id=eid AND status='draft';
    RETURN 'true'::jsonb;
  END IF;
  IF op='abort' THEN
    DELETE FROM otl.townhall_events WHERE team_id=t AND channel_id=c AND event_id=eid
      AND host_user_id=actor AND status='draft';
    GET DIAGNOSTICS selected_count=ROW_COUNT; RETURN to_jsonb(selected_count=1);
  END IF;
  IF event_row.status<>'active' THEN RAISE EXCEPTION 'active event required' USING ERRCODE='40001'; END IF;
  IF op='edit' THEN
    IF event_row.host_user_id<>actor OR (p->>'expectedRevision')::integer<>event_row.revision
      OR length(btrim(coalesce(p->>'activity',''))) NOT BETWEEN 1 AND 500
      OR length(btrim(coalesce(p->>'location',''))) NOT BETWEEN 1 AND 120
      OR jsonb_typeof(p->'options') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p->'options') NOT BETWEEN 1 AND 8
    THEN RAISE EXCEPTION 'invalid event edit' USING ERRCODE='40001'; END IF;
    IF (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p->'options') x(value))
        <>jsonb_array_length(p->'options')
    THEN RAISE EXCEPTION 'duplicate event options' USING ERRCODE='22023'; END IF;
    DELETE FROM otl.townhall_event_options o WHERE o.team_id=t AND o.channel_id=c AND o.event_id=eid
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(p->'options') x(value)
        WHERE x.value::timestamptz=o.starts_at);
    INSERT INTO otl.townhall_event_options(team_id,channel_id,event_id,starts_at,position)
      SELECT t,c,eid,value::timestamptz,ordinality::smallint
      FROM jsonb_array_elements_text(p->'options') WITH ORDINALITY x(value,ordinality)
      ON CONFLICT(team_id,channel_id,event_id,starts_at)
      DO UPDATE SET position=excluded.position;
    UPDATE otl.townhall_events SET activity=btrim(p->>'activity'),location=btrim(p->>'location'),
      revision=revision+1,updated_at=transaction_timestamp()
      WHERE team_id=t AND channel_id=c AND event_id=eid RETURNING * INTO event_row;
    RETURN otl.townhall_event_json(event_row,actor);
  END IF;
  IF op='vote' THEN
    IF jsonb_typeof(p->'selected') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'selected')>8
      THEN RAISE EXCEPTION 'invalid event vote' USING ERRCODE='22023'; END IF;
    requested_count:=jsonb_array_length(p->'selected');
    IF (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p->'selected') x(value))
      <>requested_count THEN RAISE EXCEPTION 'duplicate event vote' USING ERRCODE='22023'; END IF;
    SELECT count(*) INTO selected_count FROM jsonb_array_elements_text(p->'selected') x(value)
      JOIN otl.townhall_event_options o ON o.team_id=t AND o.channel_id=c AND o.event_id=eid
        AND o.starts_at=x.value::timestamptz;
    IF selected_count<>requested_count THEN RAISE EXCEPTION 'unknown event option' USING ERRCODE='22023'; END IF;
    DELETE FROM otl.townhall_event_availability
      WHERE team_id=t AND channel_id=c AND event_id=eid AND user_id=actor;
    INSERT INTO otl.townhall_event_availability(team_id,channel_id,event_id,user_id,starts_at)
      SELECT t,c,eid,actor,value::timestamptz FROM jsonb_array_elements_text(p->'selected') x(value);
    RETURN otl.townhall_event_json(event_row,actor);
  END IF;
  RAISE EXCEPTION 'invalid townhall event operation' USING ERRCODE='22023';
END $$;

REVOKE ALL ON FUNCTION otl.townhall_event_json(otl.townhall_events,text),
  otl.townhall_event_execute(text,jsonb) FROM PUBLIC;

INSERT INTO otl.schema_migrations(version) VALUES('066-townhall-event-poll');
COMMIT;
