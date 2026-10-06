BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:slack-native-maintainer-work:084',0));

ALTER TABLE otl.maintainer_feedback_work
  ALTER COLUMN linear_team_id DROP NOT NULL,
  ALTER COLUMN linear_issue_id DROP NOT NULL,
  ALTER COLUMN linear_issue_id DROP DEFAULT,
  ADD COLUMN stage text NOT NULL DEFAULT 'inbox',
  ADD COLUMN stage_updated_at timestamptz NOT NULL DEFAULT transaction_timestamp();

UPDATE otl.maintainer_feedback_work SET stage=CASE
  WHEN release_stage='운영 반영 완료' THEN 'done'
  WHEN release_stage IN ('순차 배포 중','배포 확인 중') THEN 'deploying'
  WHEN release_stage IN ('검토·승인 중','운영 확인 대기') OR issue_state='검토·승인 중' THEN 'review'
  WHEN issue_state='작업 중' THEN 'in_progress'
  WHEN issue_state IN ('확인 필요','종료') THEN 'blocked'
  ELSE 'inbox' END;

ALTER TABLE otl.maintainer_feedback_work
  ADD CONSTRAINT maintainer_feedback_work_stage_check
  CHECK(stage IN ('inbox','in_progress','review','blocked','deploying','done'));

CREATE OR REPLACE FUNCTION otl.maintainer_ops_execute(op text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE
  t text:=p->>'teamId'; actor text:=p->>'actorId'; k text:=p->>'workKey';
  member otl.maintainer_linear_members; work otl.maintainer_feedback_work;
  result jsonb; count_reserved integer; affected integer;
  linear_team uuid:=nullif(p->>'linearTeamId','')::uuid;
  requested_dri text:=nullif(p->>'desiredDri',''); requested_stage text:=p->>'stage';
BEGIN
  IF coalesce(t,'')='' OR coalesce(actor,'')!~'^[UW][A-Z0-9]+$'
    THEN RAISE EXCEPTION 'invalid maintainer operation scope' USING ERRCODE='22023'; END IF;
  IF op IN ('members','member_reserve','member_link','member_invited','member_pause',
      'work_assignment','work_stage','work_linear_prepare')
    AND NOT EXISTS(SELECT 1 FROM otl.community_maintainers m
      WHERE m.team_id=t AND m.user_id=actor AND m.state='active')
    AND actor IS DISTINCT FROM p->>'founderId'
    THEN RAISE EXCEPTION 'active maintainer required' USING ERRCODE='42501'; END IF;

  IF op='members' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('userId',m.user_id,'displayName',w.display_name,
      'linearUserId',l.linear_user_id,'linearState',coalesce(l.state,'not_connected')) ORDER BY w.display_name),'[]'::jsonb)
      INTO result FROM otl.community_maintainers m JOIN otl.workspace_members w USING(team_id,user_id)
      LEFT JOIN otl.maintainer_linear_members l USING(team_id,user_id)
      WHERE m.team_id=t AND m.state='active' AND NOT w.is_bot AND NOT w.is_app_user AND NOT w.slack_deleted;
    RETURN result;
  END IF;
  IF op='member_get' THEN
    SELECT * INTO member FROM otl.maintainer_linear_members WHERE team_id=t AND user_id=p->>'userId';
    RETURN CASE WHEN FOUND THEN to_jsonb(member) ELSE 'null'::jsonb END;
  END IF;
  IF op IN ('member_reserve','member_link') THEN
    IF NOT EXISTS(SELECT 1 FROM otl.community_maintainers m JOIN otl.workspace_members w USING(team_id,user_id)
      WHERE m.team_id=t AND m.user_id=p->>'userId' AND m.state='active'
      AND NOT w.is_bot AND NOT w.is_app_user AND NOT w.slack_deleted)
      THEN RAISE EXCEPTION 'target must opt in as maintainer' USING ERRCODE='42501'; END IF;
    IF linear_team IS NULL THEN RAISE EXCEPTION 'linear team required' USING ERRCODE='22023'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('otl:linear-capacity:'||t,0));
    SELECT * INTO member FROM otl.maintainer_linear_members WHERE team_id=t AND user_id=p->>'userId' FOR UPDATE;
    IF FOUND AND member.linear_team_id IS DISTINCT FROM linear_team
      THEN RAISE EXCEPTION 'linear team mismatch' USING ERRCODE='42501'; END IF;
    IF op='member_reserve' AND (NOT FOUND OR member.state='paused') THEN
      SELECT count(*) INTO count_reserved FROM otl.maintainer_linear_members
        WHERE team_id=t AND state<>'paused' AND seat_source='invited';
      IF count_reserved>=coalesce((p->>'seatLimit')::integer,0)
        THEN RAISE EXCEPTION 'linear invitation capacity exhausted' USING ERRCODE='54000'; END IF;
    END IF;
    INSERT INTO otl.maintainer_linear_members(team_id,user_id,linear_team_id,linear_user_id,state,seat_source)
      VALUES(t,p->>'userId',linear_team,(p->>'linearUserId')::uuid,
        CASE WHEN op='member_link' THEN 'linked' ELSE 'reserved' END,
        CASE WHEN op='member_link' THEN 'existing' ELSE 'invited' END)
      ON CONFLICT(team_id,user_id) DO UPDATE SET
        linear_user_id=CASE WHEN op='member_link' THEN excluded.linear_user_id ELSE maintainer_linear_members.linear_user_id END,
        state=CASE WHEN op='member_link' THEN 'linked' WHEN maintainer_linear_members.state='paused' THEN 'reserved' ELSE maintainer_linear_members.state END,
        updated_at=transaction_timestamp()
      RETURNING * INTO member;
    RETURN to_jsonb(member);
  END IF;
  IF op IN ('member_invited','member_pause') THEN
    UPDATE otl.maintainer_linear_members SET state=CASE WHEN op='member_invited' THEN 'invited' ELSE 'paused' END,
      linear_user_id=CASE WHEN op='member_pause' THEN NULL ELSE linear_user_id END,
      updated_at=transaction_timestamp()
      WHERE team_id=t AND user_id=p->>'userId' AND linear_team_id=linear_team
      RETURNING * INTO member;
    RETURN CASE WHEN FOUND THEN to_jsonb(member) ELSE 'null'::jsonb END;
  END IF;
  IF op='work_put' THEN
    IF requested_dri IS NOT NULL AND requested_dri!~'^[UW][A-Z0-9]+$'
      THEN RAISE EXCEPTION 'invalid desired DRI' USING ERRCODE='22023'; END IF;
    IF requested_dri IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM otl.community_maintainers m
      WHERE m.team_id=t AND m.user_id=requested_dri AND m.state='active')
      THEN RAISE EXCEPTION 'desired DRI must be active maintainer' USING ERRCODE='42501'; END IF;
    INSERT INTO otl.maintainer_feedback_work(team_id,work_key,reporter_id,desired_dri,dri_user_id,
      linear_team_id,linear_issue_id,title,actual,expected,work_kind,source_channel,source_thread)
      VALUES(t,k,p->>'reporterId',requested_dri,requested_dri,linear_team,
        CASE WHEN linear_team IS NULL THEN NULL ELSE gen_random_uuid() END,
        p->>'title',p->>'actual',coalesce(p->>'expected',''),coalesce(p->>'workKind','feedback'),
        p->>'sourceChannel',p->>'sourceThread')
      ON CONFLICT(team_id,work_key) DO UPDATE SET title=excluded.title,actual=excluded.actual,
        expected=excluded.expected,source_channel=excluded.source_channel,
        source_thread=excluded.source_thread,updated_at=transaction_timestamp();
  END IF;
  IF op='work_get' OR op='work_put' THEN
    SELECT * INTO work FROM otl.maintainer_feedback_work WHERE team_id=t AND work_key=k;
    RETURN CASE WHEN FOUND THEN to_jsonb(work) ELSE 'null'::jsonb END;
  END IF;
  IF op='work_by_issue' THEN
    SELECT * INTO work FROM otl.maintainer_feedback_work WHERE team_id=t AND linear_issue_id=(p->>'issueId')::uuid;
    RETURN CASE WHEN FOUND THEN to_jsonb(work) ELSE 'null'::jsonb END;
  END IF;
  IF op='work_linear_prepare' THEN
    IF linear_team IS NULL THEN RAISE EXCEPTION 'linear team required' USING ERRCODE='22023'; END IF;
    UPDATE otl.maintainer_feedback_work SET linear_team_id=linear_team,
      linear_issue_id=coalesce(linear_issue_id,gen_random_uuid()),sync_state='pending',
      updated_at=transaction_timestamp()
      WHERE team_id=t AND work_key=k RETURNING * INTO work;
    RETURN CASE WHEN FOUND THEN to_jsonb(work) ELSE 'null'::jsonb END;
  END IF;
  IF op='work_sync' THEN
    UPDATE otl.maintainer_feedback_work SET linear_team_id=linear_team,
      linear_identifier=p->>'identifier',linear_url=p->>'url',issue_state=p->>'issueState',
      dri_user_id=coalesce(nullif(p->>'driUserId',''),dri_user_id),
      sync_state='synced',linear_updated_at=(p->>'linearUpdatedAt')::timestamptz,
      updated_at=transaction_timestamp()
      WHERE team_id=t AND work_key=k AND linear_team_id=linear_team
      AND (linear_updated_at IS NULL OR linear_updated_at<=(p->>'linearUpdatedAt')::timestamptz)
      RETURNING * INTO work;
    IF NOT FOUND THEN SELECT * INTO work FROM otl.maintainer_feedback_work WHERE team_id=t AND work_key=k; END IF;
    RETURN CASE WHEN FOUND THEN to_jsonb(work) ELSE 'null'::jsonb END;
  END IF;
  IF op='work_assignment' THEN
    IF coalesce(p->>'driUserId','')!~'^[UW][A-Z0-9]+$'
      THEN RAISE EXCEPTION 'invalid DRI' USING ERRCODE='22023'; END IF;
    IF NOT EXISTS(SELECT 1 FROM otl.community_maintainers m
      WHERE m.team_id=t AND m.user_id=p->>'driUserId' AND m.state='active')
      THEN RAISE EXCEPTION 'target must be active maintainer' USING ERRCODE='42501'; END IF;
    UPDATE otl.maintainer_feedback_work SET assignment_changed=true,desired_dri=p->>'driUserId',
      dri_user_id=p->>'driUserId',updated_at=transaction_timestamp()
      WHERE team_id=t AND work_key=k RETURNING * INTO work;
    RETURN CASE WHEN FOUND THEN to_jsonb(work) ELSE 'null'::jsonb END;
  END IF;
  IF op='work_stage' THEN
    IF requested_stage NOT IN ('inbox','in_progress','review','blocked')
      THEN RAISE EXCEPTION 'invalid Maintainer stage' USING ERRCODE='22023'; END IF;
    UPDATE otl.maintainer_feedback_work SET stage=requested_stage,
      stage_updated_at=transaction_timestamp(),updated_at=transaction_timestamp()
      WHERE team_id=t AND work_key=k RETURNING * INTO work;
    RETURN CASE WHEN FOUND THEN to_jsonb(work) ELSE 'null'::jsonb END;
  END IF;
  IF op='work_failed' THEN
    UPDATE otl.maintainer_feedback_work SET sync_state='failed',updated_at=transaction_timestamp()
      WHERE team_id=t AND work_key=k;
    RETURN 'true'::jsonb;
  END IF;
  IF op='work_release' THEN
    UPDATE otl.maintainer_feedback_work SET release_stage=p->>'releaseStage',
      stage=CASE
        WHEN p->>'releaseStage'='운영 반영 완료' THEN 'done'
        WHEN p->>'releaseStage' IN ('순차 배포 중','배포 확인 중') THEN 'deploying'
        WHEN p->>'releaseStage' IN ('검토·승인 중','운영 확인 대기') THEN 'review'
        WHEN p->>'releaseStage'='작업 중' THEN 'in_progress'
        WHEN p->>'releaseStage'='확인 필요' THEN 'blocked'
        ELSE stage END,
      stage_updated_at=transaction_timestamp(),updated_at=transaction_timestamp()
      WHERE team_id=t AND work_key=k RETURNING * INTO work;
    RETURN CASE WHEN FOUND THEN to_jsonb(work) ELSE 'null'::jsonb END;
  END IF;
  IF op='work_list' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) INTO result FROM
      (SELECT * FROM otl.maintainer_feedback_work WHERE team_id=t ORDER BY updated_at DESC LIMIT 100) q;
    RETURN result;
  END IF;
  IF op='public_work_list' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'key',q.work_key,'title',q.title,'stage',q.stage,'hasDri',q.dri_user_id IS NOT NULL,
      'sourceChannel',q.source_channel,'sourceThread',q.source_thread,'updatedAt',q.updated_at)
      ORDER BY q.updated_at DESC),'[]'::jsonb) INTO result
      FROM (SELECT * FROM otl.maintainer_feedback_work WHERE team_id=t AND work_kind='feedback'
        ORDER BY updated_at DESC LIMIT 100) q;
    RETURN result;
  END IF;
  IF op='surface_get' THEN
    SELECT to_jsonb(message_ts) INTO result FROM otl.maintainer_slack_surfaces
      WHERE team_id=t AND work_key=k AND channel_id=p->>'channelId';
    RETURN coalesce(result,'null'::jsonb);
  END IF;
  IF op='surface_put' THEN
    INSERT INTO otl.maintainer_slack_surfaces(team_id,work_key,channel_id,message_ts)
      VALUES(t,k,p->>'channelId',p->>'messageTs') ON CONFLICT(team_id,work_key,channel_id)
      DO UPDATE SET message_ts=excluded.message_ts,updated_at=transaction_timestamp();
    RETURN to_jsonb(p->>'messageTs');
  END IF;
  IF op='receipt_claim' THEN
    DELETE FROM otl.maintainer_ops_receipts WHERE team_id=t AND expires_at<transaction_timestamp();
    INSERT INTO otl.maintainer_ops_receipts(team_id,receipt_key) VALUES(t,p->>'receiptKey') ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS affected=ROW_COUNT;
    RETURN to_jsonb(affected=1);
  END IF;
  RAISE EXCEPTION 'invalid maintainer operation' USING ERRCODE='22023';
END $$;

INSERT INTO otl.schema_migrations(version) VALUES('084-slack-native-maintainer-work');
COMMIT;
