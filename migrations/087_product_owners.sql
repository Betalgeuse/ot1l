BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:product-owners:087',0));
CREATE TABLE otl.product_owners (
  team_id text NOT NULL, user_id text NOT NULL CHECK(user_id~'^[UW][A-Z0-9]+$'),
  display_name text NOT NULL CHECK(length(btrim(display_name)) BETWEEN 1 AND 80),
  role text NOT NULL CHECK(role IN ('po','po-designer','po-dev')),
  expertise text[] NOT NULL DEFAULT '{}', active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(), PRIMARY KEY(team_id,user_id),
  CHECK(cardinality(expertise)<=10 AND array_position(expertise,NULL) IS NULL)
);
CREATE FUNCTION otl.product_owner_execute(op text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE t text:=p->>'teamId'; result jsonb;
BEGIN
  IF coalesce(t,'')='' THEN RAISE EXCEPTION 'invalid product owner scope' USING ERRCODE='22023'; END IF;
  IF op='upsert' THEN
    IF coalesce(p->>'userId','')!~'^[UW][A-Z0-9]+$' OR p->>'role' NOT IN ('po','po-designer','po-dev')
      THEN RAISE EXCEPTION 'invalid product owner' USING ERRCODE='22023'; END IF;
    INSERT INTO otl.product_owners(team_id,user_id,display_name,role,expertise)
    VALUES(t,p->>'userId',btrim(p->>'displayName'),p->>'role',
      ARRAY(SELECT btrim(value) FROM jsonb_array_elements_text(coalesce(p->'expertise','[]'::jsonb)) value
        WHERE btrim(value)<>'' LIMIT 10))
    ON CONFLICT(team_id,user_id) DO UPDATE SET display_name=excluded.display_name,role=excluded.role,
      expertise=excluded.expertise,active=true,updated_at=transaction_timestamp();
    RETURN 'true'::jsonb;
  END IF;
  IF op='list' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'displayName',display_name,
      'role',role,'expertise',to_jsonb(expertise)) ORDER BY display_name,user_id),'[]'::jsonb)
    INTO result FROM otl.product_owners
    WHERE team_id=t AND active AND (nullif(p->>'role','') IS NULL OR role=p->>'role');
    RETURN result;
  END IF;
  RAISE EXCEPTION 'invalid product owner operation' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION otl.product_owner_execute(text,jsonb) FROM PUBLIC;
INSERT INTO otl.schema_migrations(version) VALUES('087-product-owners');
COMMIT;
