BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:product-owner-groups:086',0));

ALTER TABLE otl.community_maintainers
  ADD COLUMN specialties text[] NOT NULL DEFAULT '{}'::text[]
  CHECK(specialties <@ ARRAY['designer','dev']::text[] AND cardinality(specialties)<=2);

CREATE FUNCTION otl.community_maintainer_set_specialties(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE t text:=p->>'teamId'; actor text:=p->>'actorId'; requested text[]; row otl.community_maintainers;
BEGIN
  IF coalesce(t,'')='' OR actor!~'^[UW][A-Z0-9]+$' OR jsonb_typeof(p->'specialties')<>'array'
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p->'specialties') x
      WHERE jsonb_typeof(x)<>'string' OR x#>>'{}' NOT IN ('designer','dev'))
  THEN RAISE EXCEPTION 'invalid Product Owner specialties' USING ERRCODE='22023'; END IF;
  SELECT coalesce(array_agg(DISTINCT x#>>'{}' ORDER BY x#>>'{}'),'{}'::text[]) INTO requested
    FROM jsonb_array_elements(p->'specialties') x;
  UPDATE otl.community_maintainers SET specialties=requested,revision=revision+1,
    updated_at=transaction_timestamp() WHERE team_id=t AND user_id=actor AND state='active'
    RETURNING * INTO row;
  IF NOT FOUND THEN RAISE EXCEPTION 'active Product Owner required' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('teamId',t,'userId',actor,'specialties',to_jsonb(row.specialties));
END $$;

CREATE FUNCTION otl.community_maintainer_audiences(p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE result jsonb;
BEGIN
  IF coalesce(p->>'teamId','')='' OR coalesce(p->>'actorId','')!~'^[UW][A-Z0-9]+$'
    OR NOT EXISTS(SELECT 1 FROM otl.workspace_members w WHERE w.team_id=p->>'teamId'
      AND w.user_id=p->>'actorId' AND NOT w.is_bot AND NOT w.is_app_user AND NOT w.slack_deleted)
  THEN RAISE EXCEPTION 'active workspace member required' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object(
      'po',coalesce(jsonb_agg(m.user_id ORDER BY m.user_id),'[]'::jsonb),
      'designer',coalesce(jsonb_agg(m.user_id ORDER BY m.user_id) FILTER(WHERE 'designer'=ANY(m.specialties)),'[]'::jsonb),
      'dev',coalesce(jsonb_agg(m.user_id ORDER BY m.user_id) FILTER(WHERE 'dev'=ANY(m.specialties)),'[]'::jsonb))
    INTO result FROM otl.community_maintainers m WHERE m.team_id=p->>'teamId' AND m.state='active';
  RETURN result;
END
$$;

CREATE FUNCTION otl.community_maintainer_clear_specialties() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,otl AS $$ BEGIN
  IF NEW.state<>'active' THEN NEW.specialties:='{}'::text[]; END IF; RETURN NEW;
END $$;
CREATE TRIGGER community_maintainer_clear_specialties BEFORE UPDATE OF state ON otl.community_maintainers
FOR EACH ROW EXECUTE FUNCTION otl.community_maintainer_clear_specialties();

REVOKE ALL ON FUNCTION otl.community_maintainer_set_specialties(jsonb),
  otl.community_maintainer_audiences(jsonb),otl.community_maintainer_clear_specialties() FROM PUBLIC;
INSERT INTO otl.schema_migrations(version) VALUES('086-product-owner-groups');
COMMIT;
