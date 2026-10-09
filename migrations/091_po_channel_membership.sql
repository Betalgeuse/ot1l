BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:po-channel-membership:091',0));

CREATE TABLE otl.po_membership_snapshots (
  team_id text PRIMARY KEY, observed_at timestamptz NOT NULL,
  channels jsonb NOT NULL, member_count integer NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE FUNCTION otl.community_po_reconcile(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE t text:=p->>'teamId'; observed timestamptz:=(p->>'observedAt')::timestamptz;
  member jsonb; activated integer:=0; removed integer:=0; result jsonb;
BEGIN
  IF coalesce(t,'')='' OR observed IS NULL OR observed>clock_timestamp()+interval '30 seconds'
    OR observed<clock_timestamp()-interval '10 minutes' OR p->'complete' IS DISTINCT FROM 'true'::jsonb
    OR jsonb_typeof(p->'channels') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'channels') NOT BETWEEN 1 AND 20
    OR jsonb_typeof(p->'members') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'members')>10000
    OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p->'channels') c WHERE c!~'^[CG][A-Z0-9]+$')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p->'members') m WHERE coalesce(m->>'userId','')!~'^[UW][A-Z0-9]+$'
      OR length(coalesce(m->>'displayName','')) NOT BETWEEN 1 AND 200)
  THEN RAISE EXCEPTION 'complete verified PO membership snapshot required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('otl:po-membership:'||t,0));
  IF EXISTS(SELECT 1 FROM otl.po_membership_snapshots WHERE team_id=t AND observed_at>=observed)
  THEN RETURN jsonb_build_object('applied',false,'reason','older_snapshot'); END IF;
  FOR member IN SELECT value FROM jsonb_array_elements(p->'members') LOOP
    IF EXISTS(SELECT 1 FROM otl.community_maintainers WHERE team_id=t AND user_id=member->>'userId' AND state='revoked')
    THEN CONTINUE; END IF;
    PERFORM otl.community_maintainer_sync_profile(jsonb_build_object('teamId',t,'actorId',member->>'userId',
      'displayName',member->>'displayName','isBot',false,'isAppUser',false,'deleted',false));
    result:=otl.community_maintainer_execute('activate',jsonb_build_object('teamId',t,'actorId',member->>'userId'));
    IF result->>'changed'='true' THEN activated:=activated+1; END IF;
  END LOOP;
  UPDATE otl.community_maintainers SET state='inactive',revision=revision+1,updated_at=transaction_timestamp()
    WHERE team_id=t AND state='active' AND NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(p->'members') m WHERE m->>'userId'=community_maintainers.user_id);
  GET DIAGNOSTICS removed=ROW_COUNT;
  INSERT INTO otl.po_membership_snapshots(team_id,observed_at,channels,member_count)
    VALUES(t,observed,p->'channels',jsonb_array_length(p->'members'))
    ON CONFLICT(team_id) DO UPDATE SET observed_at=excluded.observed_at,channels=excluded.channels,
      member_count=excluded.member_count,applied_at=transaction_timestamp();
  RETURN jsonb_build_object('applied',true,'activated',activated,'deactivated',removed,'observedMembers',jsonb_array_length(p->'members'));
END $$;
REVOKE ALL ON FUNCTION otl.community_po_reconcile(jsonb) FROM PUBLIC;
-- Preserve the existing runtime permission boundary, not a new public RPC.
DO $$ DECLARE grant_row record; BEGIN
  FOR grant_row IN SELECT DISTINCT a.grantee FROM pg_proc f,
    LATERAL aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
    WHERE f.oid='otl.community_maintainer_execute(text,jsonb)'::regprocedure AND a.privilege_type='EXECUTE' AND a.grantee<>0
  LOOP EXECUTE format('GRANT EXECUTE ON FUNCTION otl.community_po_reconcile(jsonb) TO %I',pg_get_userbyid(grant_row.grantee)); END LOOP;
END $$;
INSERT INTO otl.schema_migrations(version) VALUES('091-po-channel-membership');
COMMIT;
