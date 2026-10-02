BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:open-maintainers:068',0));

CREATE TABLE otl.community_maintainers (
  team_id text NOT NULL,
  user_id text NOT NULL CHECK(user_id~'^[UW][A-Z0-9]+$'),
  state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','inactive','revoked')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
  activated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(team_id,user_id)
);

ALTER TABLE otl.git_changes
  ADD COLUMN change_class text NOT NULL DEFAULT 'core' CHECK(change_class IN ('open','core')),
  ADD COLUMN changed_paths jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(changed_paths)='array'),
  ADD COLUMN classification_digest text CHECK(classification_digest IS NULL OR classification_digest~'^[0-9a-f]{64}$'),
  ADD COLUMN classified_at timestamptz,
  ADD COLUMN approved_role text CHECK(approved_role IS NULL OR approved_role IN ('maintainer','founder'));

CREATE FUNCTION otl.community_maintainer_execute(op text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE
  t text:=p->>'teamId'; actor text:=p->>'actorId'; founder text:=p->>'founderId';
  row otl.community_maintainers; affected integer;
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
      WHERE community_maintainers.state='inactive';
    SELECT * INTO row FROM otl.community_maintainers WHERE team_id=t AND user_id=actor;
    IF row.state<>'active' THEN RAISE EXCEPTION 'maintainer activation denied' USING ERRCODE='42501'; END IF;
    RETURN jsonb_build_object('teamId',t,'userId',actor,'state',row.state,'revision',row.revision);
  END IF;
  IF op='status' THEN
    SELECT * INTO row FROM otl.community_maintainers WHERE team_id=t AND user_id=actor;
    RETURN CASE WHEN FOUND THEN jsonb_build_object('teamId',t,'userId',actor,'state',row.state,
      'revision',row.revision) ELSE 'null'::jsonb END;
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

CREATE FUNCTION otl.bug_runner_classify_change(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE change otl.git_changes; paths jsonb:=p->'changedPaths'; class text:=p->>'changeClass';
BEGIN
  IF p->>'teamId'='' OR p->>'headSha'!~'^[0-9a-f]{40,64}$'
    OR class NOT IN ('open','core') OR jsonb_typeof(paths)<>'array'
    OR jsonb_array_length(paths) NOT BETWEEN 1 AND 50
    OR p->>'classificationDigest'!~'^[0-9a-f]{64}$'
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(paths) x WHERE jsonb_typeof(x)<>'string')
  THEN RAISE EXCEPTION 'invalid change classification' USING ERRCODE='22023'; END IF;
  SELECT changes.* INTO change FROM otl.git_changes changes JOIN otl.bug_reports reports USING(bug_id)
    WHERE reports.team_id=p->>'teamId' AND changes.pr_number=(p->>'prNumber')::bigint
      AND changes.commit_sha=p->>'headSha' FOR UPDATE;
  IF NOT FOUND OR change.merge_status<>'awaiting_approval'
  THEN RAISE EXCEPTION 'classifiable change missing' USING ERRCODE='40001'; END IF;
  UPDATE otl.git_changes SET change_class=class,changed_paths=paths,
    classification_digest=p->>'classificationDigest',classified_at=transaction_timestamp()
    WHERE change_id=change.change_id RETURNING * INTO change;
  UPDATE otl.bug_runner_notifications SET payload=payload||jsonb_build_object(
    'changeClass',class,'headSha',change.commit_sha,'classificationDigest',change.classification_digest)
    WHERE bug_id=change.bug_id AND kind='merge_ready' AND status='pending';
  RETURN jsonb_build_object('changeId',change.change_id,'changeClass',class,
    'classificationDigest',change.classification_digest);
END $$;

CREATE FUNCTION otl.bug_merge_approval_context(p jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
  SELECT jsonb_build_object('changeId',c.change_id,'changeClass',c.change_class,
    'headSha',c.commit_sha,'classificationDigest',c.classification_digest,
    'classified',c.classified_at IS NOT NULL,'maintainer',EXISTS(
      SELECT 1 FROM otl.community_maintainers m
      WHERE m.team_id=r.team_id AND m.user_id=p->>'actorId' AND m.state='active'))
  FROM otl.git_changes c JOIN otl.bug_reports r USING(bug_id)
  WHERE r.team_id=p->>'teamId' AND r.bug_id=p->>'bugId'
    AND r.packet_revision=(p->>'packetRevision')::integer
    AND c.pr_number=(p->>'prNumber')::bigint AND c.merge_status='awaiting_approval'
$$;

CREATE FUNCTION otl.bug_actor_approve_merge(p jsonb) RETURNS jsonb
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
  role:=CASE WHEN change.change_class='core' THEN 'founder' ELSE 'maintainer' END;
  IF role='founder' AND actor<>p->>'founderId' THEN
    RAISE EXCEPTION 'founder approval required' USING ERRCODE='42501';
  ELSIF role='maintainer' AND NOT EXISTS(SELECT 1 FROM otl.community_maintainers m
    WHERE m.team_id=report.team_id AND m.user_id=actor AND m.state='active') THEN
    RAISE EXCEPTION 'active maintainer required' USING ERRCODE='42501';
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

REVOKE ALL ON FUNCTION otl.community_maintainer_execute(text,jsonb),
  otl.bug_runner_classify_change(jsonb),otl.bug_merge_approval_context(jsonb),
  otl.bug_actor_approve_merge(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION otl.bug_runner_classify_change(jsonb) TO otl_bug_runner;

INSERT INTO otl.schema_migrations(version) VALUES('068-open-maintainers');
COMMIT;
