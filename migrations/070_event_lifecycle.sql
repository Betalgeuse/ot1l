BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:event-lifecycle:070',0));

ALTER TABLE otl.townhall_events
  ADD COLUMN event_kind text NOT NULL DEFAULT 'gathering'
    CHECK(event_kind IN ('gathering','challenge','series')),
  ADD COLUMN phase text NOT NULL DEFAULT 'recruiting'
    CHECK(phase IN ('recruiting','scheduling','scheduled','confirmed','cancel_pending','cancelled','completed','paused')),
  ADD COLUMN min_confirmed smallint NOT NULL DEFAULT 2 CHECK(min_confirmed BETWEEN 1 AND 100),
  ADD COLUMN capacity smallint CHECK(capacity IS NULL OR capacity BETWEEN 1 AND 500),
  ADD COLUMN recruitment_deadline timestamptz,
  ADD COLUMN grace_hours smallint NOT NULL DEFAULT 24 CHECK(grace_hours BETWEEN 1 AND 168),
  ADD COLUMN auto_cancel boolean NOT NULL DEFAULT true,
  ADD COLUMN grace_until timestamptz,
  ADD COLUMN final_start_at timestamptz,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancellation_reason text,
  ADD CONSTRAINT townhall_event_capacity_check CHECK(capacity IS NULL OR capacity>=min_confirmed);

CREATE TABLE otl.townhall_event_participants (
  team_id text NOT NULL, channel_id text NOT NULL, event_id text NOT NULL,
  user_id text NOT NULL CHECK(user_id~'^[UW][A-Z0-9]+$'),
  state text NOT NULL CHECK(state IN ('interested','going','waitlist','declined')),
  source text NOT NULL CHECK(source IN ('button','reaction','web','host')),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(team_id,channel_id,event_id,user_id),
  FOREIGN KEY(team_id,channel_id,event_id)
    REFERENCES otl.townhall_events(team_id,channel_id,event_id) ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION otl.townhall_event_json(e otl.townhall_events,actor text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,otl AS $$
  SELECT jsonb_build_object(
    'eventId',e.event_id,'teamId',e.team_id,'channelId',e.channel_id,
    'hostUserId',e.host_user_id,'activity',e.activity,'location',e.location,
    'revision',e.revision,'status',e.status,'messageTs',e.message_ts,
    'eventKind',e.event_kind,'phase',e.phase,'minConfirmed',e.min_confirmed,
    'capacity',e.capacity,'recruitmentDeadline',e.recruitment_deadline,
    'graceHours',e.grace_hours,'autoCancel',e.auto_cancel,'graceUntil',e.grace_until,
    'finalStartAt',e.final_start_at,'cancelledAt',e.cancelled_at,
    'cancellationReason',e.cancellation_reason,
    'interestCount',(SELECT count(*) FROM otl.townhall_event_participants p
      WHERE p.team_id=e.team_id AND p.channel_id=e.channel_id AND p.event_id=e.event_id
        AND p.state IN ('interested','going','waitlist')),
    'goingCount',(SELECT count(*) FROM otl.townhall_event_participants p
      WHERE p.team_id=e.team_id AND p.channel_id=e.channel_id AND p.event_id=e.event_id AND p.state='going'),
    'waitlistCount',(SELECT count(*) FROM otl.townhall_event_participants p
      WHERE p.team_id=e.team_id AND p.channel_id=e.channel_id AND p.event_id=e.event_id AND p.state='waitlist'),
    'viewerState',(SELECT p.state FROM otl.townhall_event_participants p
      WHERE p.team_id=e.team_id AND p.channel_id=e.channel_id AND p.event_id=e.event_id AND p.user_id=actor),
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

CREATE FUNCTION otl.townhall_event_lifecycle_execute(op text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE
  t text:=p->>'teamId'; c text:=p->>'channelId'; actor text:=p->>'actorId';
  eid text:=p->>'eventId'; event_row otl.townhall_events; desired text;
  going_count integer; commitment_count integer; due_result jsonb;
  at_time timestamptz:=coalesce((p->>'now')::timestamptz,transaction_timestamp());
BEGIN
  IF coalesce(t,'')='' OR coalesce(c,'')='' THEN RAISE EXCEPTION 'event lifecycle scope required'; END IF;
  IF op='due' THEN
    WITH candidates AS (
        SELECT e.*,CASE WHEN e.final_start_at IS NULL THEN
          (SELECT count(*) FROM otl.townhall_event_participants x WHERE x.team_id=e.team_id
            AND x.channel_id=e.channel_id AND x.event_id=e.event_id
            AND x.state IN ('interested','going','waitlist'))
          ELSE (SELECT count(*) FROM otl.townhall_event_participants x WHERE x.team_id=e.team_id
            AND x.channel_id=e.channel_id AND x.event_id=e.event_id AND x.state='going') END committed
        FROM otl.townhall_events e WHERE e.team_id=t AND e.channel_id=c AND e.status='active'
          AND e.auto_cancel AND e.recruitment_deadline IS NOT NULL
          AND e.phase IN ('recruiting','scheduling','scheduled','cancel_pending') FOR UPDATE
      ), changed AS (UPDATE otl.townhall_events e SET
        phase=CASE WHEN x.committed>=e.min_confirmed THEN
          CASE WHEN e.final_start_at IS NULL THEN 'scheduling' ELSE 'confirmed' END
          WHEN e.phase<>'cancel_pending' AND e.recruitment_deadline<=at_time THEN 'cancel_pending'
          WHEN e.phase='cancel_pending' AND e.grace_until<=at_time THEN 'cancelled' ELSE e.phase END,
        grace_until=CASE WHEN x.committed<e.min_confirmed AND e.phase<>'cancel_pending'
          AND e.recruitment_deadline<=at_time THEN at_time+make_interval(hours=>e.grace_hours)
          WHEN x.committed>=e.min_confirmed THEN NULL ELSE e.grace_until END,
        cancelled_at=CASE WHEN x.committed<e.min_confirmed AND e.phase='cancel_pending'
          AND e.grace_until<=at_time THEN at_time ELSE e.cancelled_at END,
        cancellation_reason=CASE WHEN x.committed<e.min_confirmed AND e.phase='cancel_pending'
          AND e.grace_until<=at_time THEN 'minimum_not_met'
          WHEN x.committed>=e.min_confirmed THEN NULL ELSE e.cancellation_reason END,
        revision=e.revision+1,updated_at=at_time FROM candidates x
        WHERE e.team_id=x.team_id AND e.channel_id=x.channel_id AND e.event_id=x.event_id
          AND ((x.committed>=e.min_confirmed AND e.phase IN ('scheduled','cancel_pending'))
            OR (x.committed<e.min_confirmed AND e.recruitment_deadline<=at_time
              AND (e.phase<>'cancel_pending' OR e.grace_until<=at_time))) RETURNING e.*)
      SELECT coalesce(jsonb_agg(otl.townhall_event_json(changed,p->>'actorId')),'[]'::jsonb)
      INTO due_result FROM changed;
    RETURN due_result;
  END IF;
  IF actor!~'^[UW][A-Z0-9]+$' OR eid!~'^V[A-Z0-9-]{1,80}$'
  THEN RAISE EXCEPTION 'invalid event lifecycle actor'; END IF;
  SELECT * INTO event_row FROM otl.townhall_events WHERE team_id=t AND channel_id=c AND event_id=eid FOR UPDATE;
  IF NOT FOUND OR event_row.status<>'active' THEN RETURN 'null'::jsonb; END IF;
  IF op='interest' THEN
    IF coalesce((p->>'active')::boolean,false) THEN
      INSERT INTO otl.townhall_event_participants(team_id,channel_id,event_id,user_id,state,source)
        VALUES(t,c,eid,actor,'interested',coalesce(p->>'source','button'))
        ON CONFLICT(team_id,channel_id,event_id,user_id) DO UPDATE SET state='interested',
          source=excluded.source,updated_at=at_time;
    ELSE DELETE FROM otl.townhall_event_participants WHERE team_id=t AND channel_id=c
      AND event_id=eid AND user_id=actor AND state='interested'; END IF;
  ELSIF op='rsvp' THEN
    desired:=p->>'state';
    IF event_row.final_start_at IS NULL OR desired NOT IN ('going','declined')
    THEN RAISE EXCEPTION 'scheduled event required'; END IF;
    IF desired='going' AND event_row.capacity IS NOT NULL AND
      (SELECT count(*) FROM otl.townhall_event_participants x WHERE x.team_id=t AND x.channel_id=c
        AND x.event_id=eid AND x.state='going' AND x.user_id<>actor)>=event_row.capacity
    THEN desired:='waitlist'; END IF;
    INSERT INTO otl.townhall_event_participants(team_id,channel_id,event_id,user_id,state,source)
      VALUES(t,c,eid,actor,desired,'button') ON CONFLICT(team_id,channel_id,event_id,user_id)
      DO UPDATE SET state=excluded.state,source=excluded.source,updated_at=at_time;
  ELSIF op='configure' THEN
    IF event_row.host_user_id<>actor THEN RAISE EXCEPTION 'event host required'; END IF;
    UPDATE otl.townhall_events SET event_kind=p->>'eventKind',min_confirmed=(p->>'minConfirmed')::integer,
      capacity=nullif(p->>'capacity','')::integer,recruitment_deadline=nullif(p->>'recruitmentDeadline','')::timestamptz,
      grace_hours=(p->>'graceHours')::integer,auto_cancel=(p->>'autoCancel')::boolean,
      phase=CASE WHEN poll_start_date IS NULL THEN phase ELSE 'scheduling' END,
      revision=revision+1,updated_at=at_time WHERE team_id=t AND channel_id=c AND event_id=eid RETURNING * INTO event_row;
  ELSIF op='finalize' THEN
    IF event_row.host_user_id<>actor OR NOT EXISTS(SELECT 1 FROM otl.townhall_event_options o
      WHERE o.team_id=t AND o.channel_id=c AND o.event_id=eid AND o.starts_at=(p->>'startsAt')::timestamptz)
    THEN RAISE EXCEPTION 'event host and selected slot required'; END IF;
    UPDATE otl.townhall_events SET final_start_at=(p->>'startsAt')::timestamptz,phase='scheduled',
      revision=revision+1,updated_at=at_time WHERE team_id=t AND channel_id=c AND event_id=eid RETURNING * INTO event_row;
  ELSE RAISE EXCEPTION 'invalid event lifecycle operation'; END IF;
  SELECT count(*) INTO going_count FROM otl.townhall_event_participants x
    WHERE x.team_id=t AND x.channel_id=c AND x.event_id=eid AND x.state='going';
  IF event_row.final_start_at IS NOT NULL AND going_count>=event_row.min_confirmed THEN
    UPDATE otl.townhall_events SET phase='confirmed',grace_until=NULL,cancellation_reason=NULL,
      revision=revision+1,updated_at=at_time WHERE team_id=t AND channel_id=c AND event_id=eid RETURNING * INTO event_row;
  END IF;
  RETURN otl.townhall_event_json(event_row,actor);
END $$;

REVOKE ALL ON FUNCTION otl.townhall_event_lifecycle_execute(text,jsonb) FROM PUBLIC;
INSERT INTO otl.schema_migrations(version) VALUES('070-event-lifecycle');
COMMIT;
