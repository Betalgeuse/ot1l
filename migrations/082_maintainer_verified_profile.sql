BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE FUNCTION otl.community_maintainer_sync_profile(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE t text:=p->>'teamId'; actor text:=p->>'actorId';
BEGIN
  IF coalesce(t,'')='' OR coalesce(actor,'')!~'^[UW][A-Z0-9]+$'
    OR length(coalesce(p->>'displayName','')) NOT BETWEEN 1 AND 200
    OR p->'isBot' IS DISTINCT FROM 'false'::jsonb
    OR p->'isAppUser' IS DISTINCT FROM 'false'::jsonb
    OR p->'deleted' IS DISTINCT FROM 'false'::jsonb
  THEN RAISE EXCEPTION 'verified Slack member required' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM otl.community_maintainers WHERE team_id=t AND user_id=actor AND state='revoked')
  THEN RAISE EXCEPTION 'maintainer revoked' USING ERRCODE='42501'; END IF;
  INSERT INTO otl.workspaces(team_id) VALUES(t) ON CONFLICT DO NOTHING;
  INSERT INTO otl.workspace_members(team_id,user_id,display_name,is_bot,is_app_user,slack_deleted,directory_synced_at,first_observed_at)
    VALUES(t,actor,p->>'displayName',false,false,false,transaction_timestamp(),transaction_timestamp())
    ON CONFLICT(team_id,user_id) DO UPDATE SET display_name=excluded.display_name,
      is_bot=false,is_app_user=false,slack_deleted=false,directory_synced_at=excluded.directory_synced_at;
  RETURN 'true'::jsonb;
END $$;
REVOKE ALL ON FUNCTION otl.community_maintainer_sync_profile(jsonb) FROM PUBLIC;
INSERT INTO otl.schema_migrations(version) VALUES('082-maintainer-verified-profile');
COMMIT;
