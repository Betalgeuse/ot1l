BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:event-participant-roster:075',0));

CREATE OR REPLACE FUNCTION otl.townhall_event_enriched_json(e otl.townhall_events,actor text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,otl AS $$
  SELECT otl.townhall_event_json(e,actor) || jsonb_build_object(
    'durationMinutes',e.duration_minutes,
    'finalEndAt',CASE WHEN e.final_start_at IS NULL THEN NULL ELSE
      to_char((e.final_start_at+make_interval(mins=>e.duration_minutes)) AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS"Z"') END,
    'participants',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'userId',p.user_id,'state',p.state) ORDER BY p.updated_at,p.user_id)
      FROM otl.townhall_event_participants p WHERE p.team_id=e.team_id
        AND p.channel_id=e.channel_id AND p.event_id=e.event_id
        AND p.state IN ('going','waitlist')),'[]'::jsonb),
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

INSERT INTO otl.schema_migrations(version) VALUES('075-event-participant-roster');
COMMIT;
