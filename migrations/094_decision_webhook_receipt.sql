BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:decision-webhook-receipt:094',0));

CREATE TABLE otl.decision_webhook_receipt (
  webhook_id text PRIMARY KEY,
  decision_id text NOT NULL, approval_ref text NOT NULL, unit text NOT NULL,
  intent text NOT NULL, choice text NOT NULL, via text NOT NULL, effect_name text NOT NULL,
  version integer NOT NULL, body_sha256 text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX decision_webhook_receipt_decision_idx ON otl.decision_webhook_receipt(decision_id,version);
CREATE INDEX decision_webhook_receipt_received_idx ON otl.decision_webhook_receipt(received_at);

-- One receipt per webhook id. A decision_id with an equal or newer stored version is a no-op.
CREATE FUNCTION otl.octo_decision_receipt_record(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE inserted text;
BEGIN
  IF coalesce(p->>'webhookId','')='' OR coalesce(p->>'decisionId','')='' OR (p->>'version')::integer IS NULL
    THEN RAISE EXCEPTION 'invalid decision receipt'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('otl:decision-receipt:'||(p->>'decisionId'),0));
  IF EXISTS(SELECT 1 FROM otl.decision_webhook_receipt
    WHERE decision_id=p->>'decisionId' AND version>=(p->>'version')::integer)
    THEN RETURN jsonb_build_object('status','duplicate'); END IF;
  INSERT INTO otl.decision_webhook_receipt(webhook_id,decision_id,approval_ref,unit,intent,choice,via,effect_name,version,body_sha256)
    VALUES(p->>'webhookId',p->>'decisionId',p->>'approvalRef',p->>'unit',p->>'intent',p->>'choice',
      p->>'via',p->>'effectName',(p->>'version')::integer,p->>'bodySha256')
    ON CONFLICT (webhook_id) DO NOTHING RETURNING webhook_id INTO inserted;
  RETURN jsonb_build_object('status',CASE WHEN inserted IS NULL THEN 'duplicate' ELSE 'accepted' END);
END $$;

CREATE FUNCTION otl.octo_decision_receipt_purge() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE n integer;
BEGIN
  DELETE FROM otl.decision_webhook_receipt WHERE received_at<now()-interval '7 days';
  GET DIAGNOSTICS n=ROW_COUNT;
  RETURN jsonb_build_object('purged',n);
END $$;

REVOKE ALL ON TABLE otl.decision_webhook_receipt FROM PUBLIC,otl_bug_runner;
REVOKE ALL ON FUNCTION otl.octo_decision_receipt_record(jsonb),otl.octo_decision_receipt_purge() FROM PUBLIC;
-- Preserve the existing runtime permission boundary, not a new public RPC.
DO $$ DECLARE grant_row record; BEGIN
  FOR grant_row IN SELECT DISTINCT a.grantee FROM pg_proc f,
    LATERAL aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
    WHERE f.oid='otl.community_maintainer_execute(text,jsonb)'::regprocedure AND a.privilege_type='EXECUTE' AND a.grantee<>0
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION otl.octo_decision_receipt_record(jsonb),otl.octo_decision_receipt_purge() TO %I',pg_get_userbyid(grant_row.grantee));
  END LOOP;
END $$;
INSERT INTO otl.schema_migrations(version) VALUES('094-decision-webhook-receipt');
COMMIT;
