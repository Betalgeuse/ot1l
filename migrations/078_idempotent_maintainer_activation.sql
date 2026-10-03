BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:idempotent-maintainer-activation:078',0));

CREATE OR REPLACE FUNCTION otl.community_maintainer_execute(op text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE
  t text:=p->>'teamId'; actor text:=p->>'actorId'; founder text:=p->>'founderId';
  row otl.community_maintainers; affected integer; changed boolean:=false;
BEGIN
  IF coalesce(t,'')='' OR actor!~'^[UW][A-Z0-9]+$'
  THEN RAISE EXCEPTION 'invalid maintainer scope' USING ERRCODE='22023'; END IF;
  IF op='activate' THEN
    IF NOT EXISTS(SELECT 1 FROM otl.workspace_members m
      WHERE m.team_id=t AND m.user_id=actor AND NOT m.is_bot AND NOT m.is_app_user AND NOT m.slack_deleted)
    THEN RAISE EXCEPTION 'active workspace member required' USING ERRCODE='42501'; END IF;
    INSERT INTO otl.community_maintainers(team_id,user_id,state)
      VALUES(t,actor,'active')
      ON CONFLICT(team_id,user_id) DO UPDATE SET state='active',revision=community_maintainers.revision+1,
        activated_at=transaction_timestamp(),updated_at=transaction_timestamp()
      WHERE community_maintainers.state='inactive'
      RETURNING true INTO changed;
    SELECT * INTO row FROM otl.community_maintainers WHERE team_id=t AND user_id=actor;
    IF row.state<>'active' THEN RAISE EXCEPTION 'maintainer activation denied' USING ERRCODE='42501'; END IF;
    RETURN jsonb_build_object('teamId',t,'userId',actor,'state',row.state,'revision',row.revision,
      'changed',coalesce(changed,false));
  END IF;
  IF op='status' THEN
    SELECT * INTO row FROM otl.community_maintainers WHERE team_id=t AND user_id=actor;
    RETURN CASE WHEN FOUND THEN jsonb_build_object('teamId',t,'userId',actor,'state',row.state,
      'revision',row.revision,'changed',false) ELSE 'null'::jsonb END;
  END IF;
  IF op='deactivate' THEN
    UPDATE otl.community_maintainers SET state='inactive',revision=revision+1,updated_at=transaction_timestamp()
      WHERE team_id=t AND user_id=actor AND state='active';
    GET DIAGNOSTICS affected=ROW_COUNT; RETURN to_jsonb(affected=1);
  END IF;
  IF op='revoke' THEN
    IF founder!~'^[UW][A-Z0-9]+$' OR p->>'requestedBy'<>founder
    THEN RAISE EXCEPTION 'founder required' USING ERRCODE='42501'; END IF;
    UPDATE otl.community_maintainers SET state='revoked',revision=revision+1,updated_at=transaction_timestamp()
      WHERE team_id=t AND user_id=actor AND state<>'revoked';
    GET DIAGNOSTICS affected=ROW_COUNT; RETURN to_jsonb(affected=1);
  END IF;
  RAISE EXCEPTION 'invalid maintainer operation' USING ERRCODE='22023';
END $$;

INSERT INTO otl.schema_migrations(version) VALUES('078-idempotent-maintainer-activation');
COMMIT;
