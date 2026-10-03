BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:superseding-delivery-resolution:077',0));

INSERT INTO otl.bug_transition_contract(
  from_state,to_state,variant,actor_requirements,guard_code,required_guard_keys,
  required_evidence_keys,side_effect,resume_state
) VALUES(
  'merge_eligible','resolved','superseding_delivery','[["admin","deployer"]]',
  'superseding_delivery',ARRAY['mergedOnMain','deployed','scenarioPass'],
  ARRAY['commitSha','workerVersion','checkReceipt','prNumber'],'notice',NULL
) ON CONFLICT DO NOTHING;

CREATE FUNCTION otl.bug_record_superseding_delivery(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE r otl.bug_reports; transitioned jsonb;
BEGIN
  IF coalesce(p->>'teamId','')='' OR coalesce(p->>'bugId','')=''
    OR coalesce(p->>'adminId','')='' OR coalesce(p->>'commitSha','')!~'^[0-9a-f]{40}$'
    OR coalesce(p->>'workerVersion','')!~'^[0-9a-f-]{36}$'
    OR coalesce(p->>'checkReceipt','')!~'^[0-9a-f]{64}$'
    OR (p->>'prNumber')::bigint<1
  THEN RAISE EXCEPTION 'invalid superseding delivery' USING ERRCODE='22023'; END IF;
  SELECT * INTO r FROM otl.bug_reports WHERE team_id=p->>'teamId'
    AND bug_id=p->>'bugId' FOR UPDATE;
  IF NOT FOUND OR r.state<>'merge_eligible'
  THEN RAISE EXCEPTION 'superseding delivery state mismatch' USING ERRCODE='40001'; END IF;
  transitioned:=otl.bug_transition(jsonb_build_object(
    'bugId',r.bug_id,'toState','resolved','variant','superseding_delivery',
    'actors',jsonb_build_array('admin','deployer'),
    'guard',jsonb_build_object('mergedOnMain',true,'deployed',true,'scenarioPass',true),
    'evidence',jsonb_build_object('commitSha',p->>'commitSha',
      'workerVersion',p->>'workerVersion','checkReceipt',p->>'checkReceipt',
      'prNumber',(p->>'prNumber')::bigint),
    'expectedRevision',r.revision,
    'idempotencyKey','superseding-delivery:'||r.bug_id||':'||(p->>'commitSha')));
  UPDATE otl.bug_reports SET head_sha=p->>'commitSha',deployed_version=p->>'workerVersion'
    WHERE bug_id=r.bug_id;
  RETURN transitioned;
END $$;

REVOKE ALL ON FUNCTION otl.bug_record_superseding_delivery(jsonb) FROM PUBLIC;
INSERT INTO otl.schema_migrations(version) VALUES('077-superseding-delivery-resolution');
COMMIT;
