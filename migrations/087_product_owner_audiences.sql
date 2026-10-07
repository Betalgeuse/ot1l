BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:product-owner-audiences:087',0));

ALTER TABLE otl.community_maintainers
  ADD COLUMN specialties text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD CONSTRAINT community_maintainers_specialties_check CHECK(
    specialties <@ ARRAY['designer','dev']::text[]
    AND cardinality(specialties)<=2
  );

CREATE FUNCTION otl.product_owner_audience_execute(op text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE
  t text:=p->>'teamId'; actor text:=p->>'actorId'; audience text:=p->>'audience';
  requested text[]; result jsonb;
BEGIN
  IF coalesce(t,'')='' OR actor!~'^[UW][A-Z0-9]+$'
    THEN RAISE EXCEPTION 'invalid Product Owner audience scope' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM otl.community_maintainers m
    WHERE m.team_id=t AND m.user_id=actor AND m.state='active')
    AND actor IS DISTINCT FROM p->>'founderId'
    THEN RAISE EXCEPTION 'active Product Owner required' USING ERRCODE='42501'; END IF;

  IF op='get' THEN
    SELECT to_jsonb(m.specialties) INTO result FROM otl.community_maintainers m
      WHERE m.team_id=t AND m.user_id=actor AND m.state='active';
    RETURN coalesce(result,'[]'::jsonb);
  END IF;
  IF op='set' THEN
    IF jsonb_typeof(p->'specialties') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p->'specialties')>2
      OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p->'specialties') AS item(value)
        WHERE value NOT IN ('designer','dev'))
      THEN RAISE EXCEPTION 'invalid Product Owner specialties' USING ERRCODE='22023'; END IF;
    SELECT coalesce(array_agg(DISTINCT value ORDER BY value),ARRAY[]::text[]) INTO requested
      FROM jsonb_array_elements_text(p->'specialties') AS item(value);
    UPDATE otl.community_maintainers SET specialties=requested,
      revision=revision+1,updated_at=transaction_timestamp()
      WHERE team_id=t AND user_id=actor AND state='active'
      RETURNING to_jsonb(specialties) INTO result;
    IF NOT FOUND THEN RAISE EXCEPTION 'active Product Owner required' USING ERRCODE='42501'; END IF;
    RETURN result;
  END IF;
  IF op='members' THEN
    IF audience NOT IN ('po','po-designer','po-dev')
      THEN RAISE EXCEPTION 'invalid Product Owner audience' USING ERRCODE='22023'; END IF;
    SELECT coalesce(jsonb_agg(m.user_id ORDER BY w.display_name,m.user_id),'[]'::jsonb) INTO result
      FROM otl.community_maintainers m JOIN otl.workspace_members w USING(team_id,user_id)
      WHERE m.team_id=t AND m.state='active' AND NOT w.is_bot AND NOT w.is_app_user
      AND NOT w.slack_deleted AND (audience='po'
        OR audience='po-designer' AND 'designer'=ANY(m.specialties)
        OR audience='po-dev' AND 'dev'=ANY(m.specialties));
    RETURN result;
  END IF;
  RAISE EXCEPTION 'invalid Product Owner audience operation' USING ERRCODE='22023';
END $$;

REVOKE ALL ON FUNCTION otl.product_owner_audience_execute(text,jsonb) FROM PUBLIC;
INSERT INTO otl.schema_migrations(version) VALUES('087-product-owner-audiences');
COMMIT;
