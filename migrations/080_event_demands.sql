BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:event-demands:080',0));

CREATE TABLE otl.townhall_event_demands (
  team_id text NOT NULL, channel_id text NOT NULL,
  demand_id text NOT NULL CHECK(demand_id~'^D[A-Z0-9-]{1,80}$'),
  requester_user_id text NOT NULL CHECK(requester_user_id~'^[UW][A-Z0-9]+$'),
  demand_mode text NOT NULL CHECK(demand_mode IN ('validate','host_request')),
  activity text NOT NULL CHECK(length(activity) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '' CHECK(length(description)<=500),
  location_hint text NOT NULL DEFAULT '' CHECK(length(location_hint)<=120),
  timing_hint text NOT NULL DEFAULT '' CHECK(length(timing_hint)<=120),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','closed')),
  message_ts text CHECK(message_ts IS NULL OR message_ts~'^\d+\.\d{6}$'),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(team_id,channel_id,demand_id),
  UNIQUE(team_id,channel_id,message_ts),
  FOREIGN KEY(team_id,requester_user_id) REFERENCES otl.workspace_members(team_id,user_id)
);

ALTER TABLE otl.townhall_events ADD COLUMN demand_id text;
ALTER TABLE otl.townhall_events ADD CONSTRAINT townhall_events_demand_fk
  FOREIGN KEY(team_id,channel_id,demand_id)
  REFERENCES otl.townhall_event_demands(team_id,channel_id,demand_id);

CREATE FUNCTION otl.townhall_event_demand_json(d otl.townhall_event_demands)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,otl AS $$
  SELECT jsonb_build_object(
    'teamId',d.team_id,'channelId',d.channel_id,'demandId',d.demand_id,
    'requesterUserId',d.requester_user_id,'mode',d.demand_mode,
    'activity',d.activity,'description',d.description,'locationHint',d.location_hint,
    'timingHint',d.timing_hint,'status',d.status,'messageTs',d.message_ts,
    'revision',d.revision,'events',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'eventId',e.event_id,'hostUserId',e.host_user_id,'messageTs',e.message_ts)
      ORDER BY e.created_at) FROM otl.townhall_events e
      WHERE e.team_id=d.team_id AND e.channel_id=d.channel_id AND e.demand_id=d.demand_id
        AND e.status='active' AND e.message_ts IS NOT NULL),'[]'::jsonb))
$$;

CREATE FUNCTION otl.townhall_event_demand_execute(op text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE
  t text:=p->>'teamId'; c text:=p->>'channelId'; actor text:=p->>'actorId';
  did text:=p->>'demandId'; eid text:=p->>'eventId'; row otl.townhall_event_demands;
BEGIN
  IF coalesce(t,'')='' OR c!~'^[CG][A-Z0-9]+$' OR actor!~'^[UW][A-Z0-9]+$'
    OR did!~'^D[A-Z0-9-]{1,80}$'
  THEN RAISE EXCEPTION 'invalid event demand scope' USING ERRCODE='22023'; END IF;
  IF op='create' THEN
    IF p->>'mode' NOT IN ('validate','host_request')
      OR length(btrim(coalesce(p->>'activity',''))) NOT BETWEEN 1 AND 200
      OR length(coalesce(p->>'description',''))>500
      OR length(coalesce(p->>'locationHint',''))>120
      OR length(coalesce(p->>'timingHint',''))>120
    THEN RAISE EXCEPTION 'invalid event demand' USING ERRCODE='22023'; END IF;
    INSERT INTO otl.townhall_event_demands(team_id,channel_id,demand_id,requester_user_id,
      demand_mode,activity,description,location_hint,timing_hint)
    VALUES(t,c,did,actor,p->>'mode',btrim(p->>'activity'),btrim(coalesce(p->>'description','')),
      btrim(coalesce(p->>'locationHint','')),btrim(coalesce(p->>'timingHint','')))
    ON CONFLICT DO NOTHING;
  END IF;
  SELECT * INTO row FROM otl.townhall_event_demands
    WHERE team_id=t AND channel_id=c AND demand_id=did FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event demand missing' USING ERRCODE='40001'; END IF;
  IF op IN ('edit','close','bind') AND row.requester_user_id<>actor
  THEN RAISE EXCEPTION 'event demand owner mismatch' USING ERRCODE='42501'; END IF;
  IF op='create' OR op='get' THEN NULL;
  ELSIF op='bind' THEN
    IF row.status='active' THEN RETURN otl.townhall_event_demand_json(row); END IF;
    IF row.status<>'draft' OR p->>'messageTs'!~'^\d+\.\d{6}$'
    THEN RAISE EXCEPTION 'invalid event demand bind' USING ERRCODE='22023'; END IF;
    UPDATE otl.townhall_event_demands SET status='active',message_ts=p->>'messageTs',
      updated_at=transaction_timestamp() WHERE team_id=t AND channel_id=c AND demand_id=did
      RETURNING * INTO row;
  ELSIF op='edit' THEN
    IF row.status<>'active' OR row.revision<>(p->>'expectedRevision')::integer
      OR p->>'mode' NOT IN ('validate','host_request')
      OR length(btrim(coalesce(p->>'activity',''))) NOT BETWEEN 1 AND 200
      OR length(coalesce(p->>'description',''))>500
      OR length(coalesce(p->>'locationHint',''))>120
      OR length(coalesce(p->>'timingHint',''))>120
    THEN RAISE EXCEPTION 'event demand edit conflict' USING ERRCODE='40001'; END IF;
    UPDATE otl.townhall_event_demands SET demand_mode=p->>'mode',activity=btrim(p->>'activity'),
      description=btrim(coalesce(p->>'description','')),location_hint=btrim(coalesce(p->>'locationHint','')),
      timing_hint=btrim(coalesce(p->>'timingHint','')),revision=revision+1,
      updated_at=transaction_timestamp() WHERE team_id=t AND channel_id=c AND demand_id=did
      RETURNING * INTO row;
  ELSIF op='close' THEN
    UPDATE otl.townhall_event_demands SET status='closed',revision=revision+1,
      updated_at=transaction_timestamp() WHERE team_id=t AND channel_id=c AND demand_id=did
      AND status='active' RETURNING * INTO row;
  ELSIF op='link_event' THEN
    IF row.status<>'active' OR eid!~'^V[A-Z0-9-]{1,80}$' THEN
      RAISE EXCEPTION 'open demand required' USING ERRCODE='40001'; END IF;
    UPDATE otl.townhall_events SET demand_id=did,updated_at=transaction_timestamp()
      WHERE team_id=t AND channel_id=c AND event_id=eid AND host_user_id=actor
        AND status IN ('draft','active') AND (demand_id IS NULL OR demand_id=did);
    IF NOT FOUND THEN RAISE EXCEPTION 'event demand link failed' USING ERRCODE='42501'; END IF;
  ELSE RAISE EXCEPTION 'invalid event demand operation' USING ERRCODE='22023'; END IF;
  SELECT * INTO row FROM otl.townhall_event_demands WHERE team_id=t AND channel_id=c AND demand_id=did;
  RETURN otl.townhall_event_demand_json(row);
END $$;

REVOKE ALL ON FUNCTION otl.townhall_event_demand_json(otl.townhall_event_demands),
  otl.townhall_event_demand_execute(text,jsonb) FROM PUBLIC;
INSERT INTO otl.schema_migrations(version) VALUES('080-event-demands');
COMMIT;
