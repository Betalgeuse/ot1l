BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:founder-open-approval:081',0));

CREATE OR REPLACE FUNCTION otl.bug_actor_approve_merge(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE report otl.bug_reports; change otl.git_changes; role text; actor text:=p->>'actorId';
BEGIN
  IF actor!~'^[UW][A-Z0-9]+$' OR p->>'founderId'!~'^[UW][A-Z0-9]+$'
    OR coalesce(p->>'idempotencyKey','')='' THEN
    RAISE EXCEPTION 'invalid merge actor' USING ERRCODE='22023'; END IF;
  SELECT * INTO report FROM otl.bug_reports WHERE bug_id=p->>'bugId' FOR UPDATE;
  SELECT * INTO change FROM otl.git_changes WHERE bug_id=report.bug_id
    AND pr_number=(p->>'prNumber')::bigint ORDER BY change_id DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR report.team_id<>p->>'teamId' OR report.state<>'merge_eligible'
    OR report.packet_revision<>(p->>'packetRevision')::integer
    OR change.merge_status NOT IN ('awaiting_approval','approved','claimed','merged')
    OR change.classified_at IS NULL OR change.classification_digest IS NULL
    OR change.commit_sha<>p->>'headSha' OR change.classification_digest<>p->>'classificationDigest'
  THEN RAISE EXCEPTION 'merge approval scope mismatch' USING ERRCODE='42501'; END IF;
  role:=CASE
    WHEN change.change_class='core' OR actor=p->>'founderId' THEN 'founder'
    ELSE 'maintainer'
  END;
  IF change.change_class='core' AND actor<>p->>'founderId' THEN
    RAISE EXCEPTION 'founder approval required' USING ERRCODE='42501';
  ELSIF change.change_class='open' AND actor<>p->>'founderId'
    AND NOT EXISTS(SELECT 1 FROM otl.community_maintainers m
      WHERE m.team_id=report.team_id AND m.user_id=actor AND m.state='active') THEN
    RAISE EXCEPTION 'active maintainer or founder required' USING ERRCODE='42501';
  END IF;
  IF change.merge_status IN ('approved','claimed','merged') THEN
    RETURN jsonb_build_object('accepted',true,'changed',false,'status',change.merge_status,
      'changeId',change.change_id,'changeClass',change.change_class,'approvedRole',change.approved_role);
  END IF;
  UPDATE otl.git_changes SET merge_status='approved',approved_by=actor,approved_role=role,
    approved_at=transaction_timestamp() WHERE change_id=change.change_id RETURNING * INTO change;
  INSERT INTO otl.bug_events(bug_id,idempotency_key,from_state,to_state,variant,revision,
    actors,guard_code,evidence,occurred_at) VALUES(report.bug_id,p->>'idempotencyKey',report.state,report.state,
    'merge_approval',report.revision,jsonb_build_array(role),'merge_approved',jsonb_build_object(
      'actorId',actor,'role',role,'prNumber',change.pr_number,'headSha',change.commit_sha,
      'classificationDigest',change.classification_digest),transaction_timestamp())
    ON CONFLICT(bug_id,idempotency_key) DO NOTHING;
  RETURN jsonb_build_object('accepted',true,'changed',true,'status',change.merge_status,
    'changeId',change.change_id,'changeClass',change.change_class,'approvedRole',role);
END $$;

INSERT INTO otl.schema_migrations(version) VALUES('081-founder-open-approval');
COMMIT;
