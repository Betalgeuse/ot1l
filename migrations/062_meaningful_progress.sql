BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:meaningful-progress:062',0));

ALTER TABLE otl.community_days DROP CONSTRAINT IF EXISTS community_days_outcome_check;
ALTER TABLE otl.community_days ADD CONSTRAINT community_days_outcome_check
  CHECK(outcome IN ('pending','complete','progress','partial','not_done'));

CREATE OR REPLACE VIEW otl.goals AS
 SELECT d.team_id,d.user_id,d.day AS goal_date,d.goal AS goal_text,
   (d.outcome IN ('complete','progress')) AS completed,d.last_event_time AS revision
 FROM otl.community_days d
 JOIN otl.workspaces w ON w.team_id=d.team_id AND w.primary_goal_channel_id=d.channel_id
 WHERE d.goal<>'';

DO $$
DECLARE function_name text; definition text; changed text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY['community_execute_core','community_execute_v1'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO definition
    FROM pg_proc p WHERE p.oid=format('otl.%I(text,jsonb)',function_name)::regprocedure;
    IF position('''progress''' in definition)>0 THEN CONTINUE; END IF;
    changed:=replace(definition,
      'WHEN ''complete'',''partial'',''not_done'' THEN',
      'WHEN ''complete'',''progress'',''partial'',''not_done'' THEN');
    changed:=replace(changed,
      'NOT IN (''pending'',''complete'',''partial'',''not_done'')',
      'NOT IN (''pending'',''complete'',''progress'',''partial'',''not_done'')');
    changed:=replace(changed,
      'd.goal,d.outcome=''complete'',extract(epoch FROM clock_timestamp())',
      'd.goal,d.outcome IN (''complete'',''progress''),extract(epoch FROM clock_timestamp())');
    IF changed=definition
       OR position('WHEN ''complete'',''progress'',''partial'',''not_done'' THEN' in changed)=0
       OR position('NOT IN (''pending'',''complete'',''progress'',''partial'',''not_done'')' in changed)=0
    THEN RAISE EXCEPTION 'Unexpected % source',function_name; END IF;
    EXECUTE changed;
  END LOOP;
END $$;

ALTER FUNCTION otl.community_execute_core(text,jsonb) SET search_path=pg_catalog,otl;
ALTER FUNCTION otl.community_execute_v1(text,jsonb) SET search_path=pg_catalog,otl;
REVOKE EXECUTE ON FUNCTION otl.community_execute_core(text,jsonb),otl.community_execute_v1(text,jsonb) FROM PUBLIC;

INSERT INTO otl.schema_migrations(version) VALUES('062-meaningful-progress');
COMMIT;
