BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:durable-member-onboarding:086',0));

CREATE TABLE otl.member_onboarding_legacy_members (
  team_id text NOT NULL,
  user_id text NOT NULL,
  PRIMARY KEY(team_id,user_id)
);
INSERT INTO otl.member_onboarding_legacy_members(team_id,user_id)
SELECT DISTINCT team_id,user_id FROM (
  SELECT team_id,user_id FROM otl.workspace_channel_memberships WHERE is_current
  UNION ALL
  SELECT team_id,user_id FROM otl.guide_deliveries WHERE status='sent'
  UNION ALL
  SELECT team_id,user_id FROM otl.community_records
    WHERE status='sent' AND record_key IN ('introduction-channel-welcome','townhall-welcome')
) preserved;

CREATE TABLE otl.member_onboarding_deliveries (
  team_id text NOT NULL,
  user_id text NOT NULL CHECK(user_id~'^[UW][A-Z0-9]+$'),
  kind text NOT NULL CHECK(kind IN ('guide','introduction','reminder','townhall')),
  source_kind text NOT NULL CHECK(source_kind IN ('team_join','reconcile')),
  source_event_id text NOT NULL CHECK(length(source_event_id) BETWEEN 1 AND 160),
  source_event_ts text NOT NULL CHECK(source_event_ts~'^\d{10,}(?:[.]\d{1,6})?$'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claimed','failed','sent')),
  attempt smallint NOT NULL DEFAULT 0 CHECK(attempt BETWEEN 0 AND 5),
  available_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  worker_id text,
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(team_id,user_id,kind),
  CHECK((status='claimed')=(worker_id IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX member_onboarding_due ON otl.member_onboarding_deliveries(team_id,available_at)
  WHERE status IN ('pending','failed');

CREATE FUNCTION otl.member_onboarding_execute(op text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE
  t text:=p->>'teamId'; u text:=p->>'userId'; c text:=p->>'channelId';
  at_time timestamptz:=coalesce((p->>'now')::timestamptz,transaction_timestamp());
  source text:=p->>'sourceKind'; event_id text:=p->>'eventId'; event_ts text:=p->>'eventTs';
  claimed otl.member_onboarding_deliveries; affected integer;
BEGIN
  IF coalesce(t,'')='' OR u!~'^[UW][A-Z0-9]+$'
    THEN RAISE EXCEPTION 'invalid onboarding scope' USING ERRCODE='22023'; END IF;
  IF op='enqueue' THEN
    IF c!~'^[CG][A-Z0-9]+$' OR source NOT IN ('team_join','reconcile')
      OR length(coalesce(event_id,'')) NOT BETWEEN 1 AND 160
      OR event_ts!~'^\d{10,}(?:[.]\d{1,6})?$'
      OR coalesce(p->>'displayName','')='' OR p->>'isBot'<>'false'
      OR p->>'isAppUser'<>'false' OR p->>'deleted'<>'false'
      THEN RAISE EXCEPTION 'verified human onboarding required' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM otl.member_onboarding_legacy_members l WHERE l.team_id=t AND l.user_id=u)
      THEN RETURN jsonb_build_object('enqueued',0,'legacy',true); END IF;
    INSERT INTO otl.workspaces(team_id) VALUES(t) ON CONFLICT DO NOTHING;
    INSERT INTO otl.workspace_channels(team_id,channel_id) VALUES(t,c) ON CONFLICT DO NOTHING;
    INSERT INTO otl.workspace_members(team_id,user_id,display_name,is_bot,is_app_user,slack_deleted,
      directory_synced_at,first_observed_at)
      VALUES(t,u,p->>'displayName',false,false,false,to_timestamp(event_ts::double precision),
        to_timestamp(event_ts::double precision))
      ON CONFLICT(team_id,user_id) DO UPDATE SET display_name=excluded.display_name,is_bot=false,
        is_app_user=false,slack_deleted=false,directory_synced_at=greatest(
          coalesce(workspace_members.directory_synced_at,'-infinity'::timestamptz),excluded.directory_synced_at);
    INSERT INTO otl.workspace_channel_memberships(team_id,channel_id,user_id,is_current,last_seen_at,synced_at)
      VALUES(t,c,u,true,to_timestamp(event_ts::double precision),to_timestamp(event_ts::double precision))
      ON CONFLICT(team_id,channel_id,user_id) DO UPDATE SET is_current=true,
        last_seen_at=greatest(workspace_channel_memberships.last_seen_at,excluded.last_seen_at),
        synced_at=greatest(workspace_channel_memberships.synced_at,excluded.synced_at);
    INSERT INTO otl.community_preferences(team_id,channel_id,user_id,enabled,preference_source)
      VALUES(t,c,u,EXISTS(SELECT 1 FROM otl.workspaces WHERE team_id=t AND primary_goal_channel_id=c),'default')
      ON CONFLICT DO NOTHING;
    INSERT INTO otl.member_onboarding_deliveries(team_id,user_id,kind,source_kind,source_event_id,source_event_ts)
      SELECT t,u,kind,source,event_id,event_ts
      FROM unnest(ARRAY['guide','introduction','reminder','townhall']) AS kind
      ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS affected=ROW_COUNT;
    RETURN jsonb_build_object('enqueued',affected,'legacy',false);
  END IF;
  IF op='claim' THEN
    IF coalesce(p->>'workerId','')='' OR coalesce(p->>'leaseToken','')!~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN RAISE EXCEPTION 'invalid onboarding claim' USING ERRCODE='22023'; END IF;
    UPDATE otl.member_onboarding_deliveries SET status='failed',worker_id=NULL,lease_token=NULL,
      lease_expires_at=NULL,available_at=at_time,last_error_code=coalesce(last_error_code,'lease_expired'),
      updated_at=at_time WHERE team_id=t AND status='claimed' AND lease_expires_at<at_time;
    SELECT * INTO claimed FROM otl.member_onboarding_deliveries d
      WHERE d.team_id=t AND d.status IN ('pending','failed') AND d.attempt<5 AND d.available_at<=at_time
      ORDER BY CASE d.kind WHEN 'guide' THEN 1 WHEN 'introduction' THEN 2
        WHEN 'reminder' THEN 3 ELSE 4 END,d.created_at FOR UPDATE SKIP LOCKED LIMIT 1;
    IF NOT FOUND THEN RETURN 'null'::jsonb; END IF;
    UPDATE otl.member_onboarding_deliveries SET status='claimed',attempt=attempt+1,
      worker_id=p->>'workerId',lease_token=(p->>'leaseToken')::uuid,
      lease_expires_at=at_time+interval '2 minutes',last_error_code=NULL,updated_at=at_time
      WHERE team_id=claimed.team_id AND user_id=claimed.user_id AND kind=claimed.kind
      RETURNING * INTO claimed;
    RETURN jsonb_build_object('userId',claimed.user_id,'kind',claimed.kind,
      'eventTs',claimed.source_event_ts,'attempt',claimed.attempt);
  END IF;
  IF op='finish' THEN
    IF p->>'status' NOT IN ('sent','failed') OR coalesce(p->>'leaseToken','')!~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN RAISE EXCEPTION 'invalid onboarding finish' USING ERRCODE='22023'; END IF;
    UPDATE otl.member_onboarding_deliveries SET status=p->>'status',worker_id=NULL,lease_token=NULL,
      lease_expires_at=NULL,last_error_code=CASE WHEN p->>'status'='failed' THEN p->>'errorCode' ELSE NULL END,
      available_at=CASE WHEN p->>'status'='failed' THEN at_time+interval '1 minute' ELSE available_at END,
      updated_at=at_time WHERE team_id=t AND user_id=u AND kind=p->>'kind' AND status='claimed'
      AND lease_token=(p->>'leaseToken')::uuid;
    GET DIAGNOSTICS affected=ROW_COUNT; RETURN to_jsonb(affected=1);
  END IF;
  RAISE EXCEPTION 'invalid onboarding operation' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION otl.member_onboarding_execute(text,jsonb) FROM PUBLIC;

CREATE FUNCTION otl.community_retry_failed_record(p jsonb) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
  UPDATE otl.community_records SET status='pending',reminder_lease_token=NULL,
    reminder_lease_expires_at=NULL,reminder_retry_after=NULL,reminder_last_error_code=NULL,
    updated_at=transaction_timestamp()
  WHERE team_id=p->>'teamId' AND channel_id=p->>'channelId' AND user_id=p->>'userId'
    AND record_key=p->>'key' AND status='failed' RETURNING true
$$;
REVOKE ALL ON FUNCTION otl.community_retry_failed_record(jsonb) FROM PUBLIC;

CREATE FUNCTION otl.guide_runtime_retry_failed(p jsonb) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
  UPDATE otl.guide_deliveries SET status='claimed',message_ts=NULL,updated_at=transaction_timestamp()
  WHERE team_id=p->>'teamId' AND channel_id=p->>'channelId' AND user_id=p->>'userId'
    AND guide_version=p->>'version' AND content_hash=p->>'hash'
    AND delivery_reason='join' AND status='failed' RETURNING true
$$;
REVOKE ALL ON FUNCTION otl.guide_runtime_retry_failed(jsonb) FROM PUBLIC,otl_guide_runtime;
GRANT EXECUTE ON FUNCTION otl.guide_runtime_retry_failed(jsonb) TO otl_guide_runtime;

INSERT INTO otl.schema_migrations(version) VALUES('086-durable-member-onboarding');
COMMIT;
