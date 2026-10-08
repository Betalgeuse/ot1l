BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:native-po-work:089',0));

ALTER TABLE otl.maintainer_feedback_work ALTER COLUMN linear_team_id DROP NOT NULL;
ALTER TABLE otl.maintainer_feedback_work ADD COLUMN pr_number bigint, ADD COLUMN pr_url text;
ALTER TABLE otl.maintainer_feedback_work ADD COLUMN source_is_work_root boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX maintainer_work_pr_unique ON otl.maintainer_feedback_work(team_id,pr_number) WHERE pr_number IS NOT NULL;
UPDATE otl.maintainer_feedback_work SET dri_user_id=coalesce(desired_dri,dri_user_id),
  sync_state='synced',issue_state=CASE WHEN issue_state='접수 중' THEN '의견 모으는 중' ELSE issue_state END;

ALTER FUNCTION otl.maintainer_ops_execute(text,jsonb) RENAME TO maintainer_ops_legacy_083;
CREATE FUNCTION otl.maintainer_ops_execute(op text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE t text:=p->>'teamId'; actor text:=p->>'actorId'; k text:=p->>'workKey'; work otl.maintainer_feedback_work;
BEGIN
  IF coalesce(t,'')='' OR coalesce(actor,'')!~'^[UW][A-Z0-9]+$' THEN RAISE EXCEPTION 'invalid work scope'; END IF;
  IF op='work_put' THEN
    INSERT INTO otl.maintainer_feedback_work(team_id,work_key,reporter_id,desired_dri,dri_user_id,
      title,actual,expected,work_kind,source_channel,source_thread,issue_state,sync_state,source_is_work_root)
    VALUES(t,k,p->>'reporterId',p->>'desiredDri',p->>'desiredDri',p->>'title',p->>'actual',coalesce(p->>'expected',''),
      coalesce(p->>'workKind','feedback'),p->>'sourceChannel',p->>'sourceThread','의견 모으는 중','synced',coalesce((p->>'sourceIsWorkRoot')::boolean,false))
    ON CONFLICT(team_id,work_key) DO UPDATE SET title=excluded.title,actual=excluded.actual,expected=excluded.expected,
      updated_at=clock_timestamp() RETURNING * INTO work;
    RETURN to_jsonb(work);
  END IF;
  IF op='work_by_pr' THEN
    SELECT * INTO work FROM otl.maintainer_feedback_work WHERE team_id=t AND pr_number=(p->>'prNumber')::bigint;
    RETURN CASE WHEN FOUND THEN to_jsonb(work) ELSE 'null'::jsonb END;
  END IF;
  IF op='backfill_pending' THEN
    RETURN (SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) FROM (
      SELECT r.bug_id,r.reporter_id,r.source_channel_id,r.source_thread,r.packet_revision
      FROM otl.bug_reports r LEFT JOIN otl.maintainer_slack_surfaces s
        ON s.team_id=r.team_id AND s.work_key=r.bug_id AND s.channel_id=p->>'channelId'
      WHERE r.team_id=t AND NOT r.privacy AND r.source_opaque_ref LIKE 'slack-feedback:%'
        AND r.state IN('new','needs_info','needs_info_exhausted') AND s.work_key IS NULL
      ORDER BY r.created_at LIMIT 10) q);
  END IF;
  IF op IN ('work_assignment','work_pr') THEN
    IF actor IS DISTINCT FROM p->>'founderId' AND NOT EXISTS(SELECT 1 FROM otl.community_maintainers
      WHERE team_id=t AND user_id=actor AND state='active') THEN RAISE EXCEPTION 'active PO required' USING ERRCODE='42501'; END IF;
    IF op='work_assignment' THEN
      IF NOT EXISTS(SELECT 1 FROM otl.community_maintainers WHERE team_id=t AND user_id=p->>'driUserId' AND state='active')
      THEN RAISE EXCEPTION 'active target PO required'; END IF;
      UPDATE otl.maintainer_feedback_work SET desired_dri=p->>'driUserId',dri_user_id=p->>'driUserId',
        assignment_changed=true,updated_at=clock_timestamp() WHERE team_id=t AND work_key=k RETURNING * INTO work;
    ELSE
      IF coalesce(p->>'prUrl','')!~'^https://github[.]com/Betalgeuse/ot1l/pull/[1-9][0-9]*$' THEN RAISE EXCEPTION 'invalid PR URL'; END IF;
      UPDATE otl.maintainer_feedback_work SET pr_number=(p->>'prNumber')::bigint,pr_url=p->>'prUrl',updated_at=clock_timestamp()
        WHERE team_id=t AND work_key=k RETURNING * INTO work;
    END IF;
    RETURN CASE WHEN FOUND THEN to_jsonb(work) ELSE 'null'::jsonb END;
  END IF;
  IF op IN ('work_sync','work_by_issue','member_reserve','member_link','member_invited','member_pause')
    THEN RAISE EXCEPTION 'Linear workflow retired' USING ERRCODE='42501'; END IF;
  RETURN otl.maintainer_ops_legacy_083(op,p);
END $$;
REVOKE ALL ON FUNCTION otl.maintainer_ops_execute(text,jsonb),otl.maintainer_ops_legacy_083(text,jsonb) FROM PUBLIC;
INSERT INTO otl.schema_migrations(version) VALUES('089-native-po-work');
COMMIT;
