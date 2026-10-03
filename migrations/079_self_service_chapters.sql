BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('otl:self-service-chapters:079',0));

CREATE TABLE otl.community_chapters (
  team_id text NOT NULL,
  slug text NOT NULL CHECK(slug~'^[a-z0-9][a-z0-9-]{1,47}$'),
  channel_id text CHECK(channel_id IS NULL OR channel_id~'^C[A-Z0-9]+$'),
  title text NOT NULL CHECK(length(title) BETWEEN 2 AND 60),
  description text NOT NULL CHECK(length(description) BETWEEN 5 AND 240),
  created_by text NOT NULL CHECK(created_by~'^[UW][A-Z0-9]+$'),
  state text NOT NULL DEFAULT 'creating' CHECK(state IN ('creating','active','failed','archived')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
  announcement_message_ts text CHECK(announcement_message_ts IS NULL OR announcement_message_ts~'^\d+\.\d{6}$'),
  guide_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(team_id,slug),
  UNIQUE(team_id,channel_id),
  FOREIGN KEY(team_id,created_by) REFERENCES otl.workspace_members(team_id,user_id)
);

CREATE FUNCTION otl.community_chapter_json(chapter_row otl.community_chapters,changed boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,otl AS $$
  SELECT jsonb_build_object('teamId',chapter_row.team_id,'slug',chapter_row.slug,
    'channelId',chapter_row.channel_id,'title',chapter_row.title,
    'description',chapter_row.description,'createdBy',chapter_row.created_by,
    'state',chapter_row.state,'revision',chapter_row.revision,'changed',changed,
    'announcementMessageTs',chapter_row.announcement_message_ts,
    'guideSynced',chapter_row.guide_synced_at IS NOT NULL)
$$;

CREATE FUNCTION otl.community_chapter_execute(op text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
DECLARE
  t text:=p->>'teamId'; actor text:=p->>'actorId'; s text:=p->>'slug'; c text:=p->>'channelId';
  row otl.community_chapters; changed boolean:=false; affected integer;
BEGIN
  IF coalesce(t,'')='' THEN RAISE EXCEPTION 'invalid chapter team' USING ERRCODE='22023'; END IF;
  IF op='request' THEN
    IF actor!~'^[UW][A-Z0-9]+$' OR s!~'^[a-z0-9][a-z0-9-]{1,47}$'
      OR length(coalesce(p->>'title','')) NOT BETWEEN 2 AND 60
      OR length(coalesce(p->>'description','')) NOT BETWEEN 5 AND 240
    THEN RAISE EXCEPTION 'invalid chapter request' USING ERRCODE='22023'; END IF;
    IF NOT EXISTS(SELECT 1 FROM otl.workspace_members m WHERE m.team_id=t AND m.user_id=actor
      AND NOT m.is_bot AND NOT m.is_app_user AND NOT m.slack_deleted)
    THEN RAISE EXCEPTION 'active workspace member required' USING ERRCODE='42501'; END IF;
    INSERT INTO otl.community_chapters(team_id,slug,title,description,created_by)
      VALUES(t,s,p->>'title',p->>'description',actor)
      ON CONFLICT(team_id,slug) DO UPDATE SET state='creating',title=excluded.title,
        description=excluded.description,revision=community_chapters.revision+1,
        updated_at=transaction_timestamp()
      WHERE community_chapters.state='failed' AND community_chapters.created_by=actor
      RETURNING true INTO changed;
    SELECT * INTO row FROM otl.community_chapters WHERE team_id=t AND slug=s FOR UPDATE;
    IF row.created_by<>actor OR row.title<>p->>'title' OR row.description<>p->>'description'
    THEN RAISE EXCEPTION 'chapter name already requested' USING ERRCODE='23505'; END IF;
    RETURN otl.community_chapter_json(row,coalesce(changed,false));
  ELSIF op='activate' THEN
    IF actor!~'^[UW][A-Z0-9]+$' OR s!~'^[a-z0-9][a-z0-9-]{1,47}$' OR c!~'^C[A-Z0-9]+$'
    THEN RAISE EXCEPTION 'invalid chapter activation' USING ERRCODE='22023'; END IF;
    SELECT * INTO row FROM otl.community_chapters WHERE team_id=t AND slug=s FOR UPDATE;
    IF NOT FOUND OR row.created_by<>actor OR row.state NOT IN ('creating','active')
    THEN RAISE EXCEPTION 'chapter activation denied' USING ERRCODE='42501'; END IF;
    IF row.state='active' AND row.channel_id<>c
    THEN RAISE EXCEPTION 'chapter channel conflict' USING ERRCODE='40001'; END IF;
    UPDATE otl.community_chapters SET channel_id=c,state='active',revision=revision+1,
      updated_at=transaction_timestamp() WHERE team_id=t AND slug=s AND state='creating'
      RETURNING true INTO changed;
    SELECT * INTO row FROM otl.community_chapters WHERE team_id=t AND slug=s;
    RETURN otl.community_chapter_json(row,coalesce(changed,false));
  ELSIF op='active' THEN
    RETURN to_jsonb(EXISTS(SELECT 1 FROM otl.community_chapters
      WHERE team_id=t AND channel_id=c AND state='active'));
  ELSIF op='mark_announcement' THEN
    IF s!~'^[a-z0-9][a-z0-9-]{1,47}$' OR c!~'^C[A-Z0-9]+$'
      OR p->>'messageTs'!~'^\d+\.\d{6}$'
    THEN RAISE EXCEPTION 'invalid chapter announcement' USING ERRCODE='22023'; END IF;
    UPDATE otl.community_chapters SET announcement_message_ts=coalesce(announcement_message_ts,p->>'messageTs'),
      updated_at=transaction_timestamp() WHERE team_id=t AND slug=s AND channel_id=c AND state='active';
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected<>1 THEN RAISE EXCEPTION 'chapter missing' USING ERRCODE='40001'; END IF;
    SELECT * INTO row FROM otl.community_chapters WHERE team_id=t AND slug=s;
    RETURN otl.community_chapter_json(row,false);
  ELSIF op='mark_guide' THEN
    IF s!~'^[a-z0-9][a-z0-9-]{1,47}$' OR c!~'^C[A-Z0-9]+$'
    THEN RAISE EXCEPTION 'invalid chapter guide' USING ERRCODE='22023'; END IF;
    UPDATE otl.community_chapters SET guide_synced_at=transaction_timestamp(),updated_at=transaction_timestamp()
      WHERE team_id=t AND slug=s AND channel_id=c AND state='active';
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected<>1 THEN RAISE EXCEPTION 'chapter missing' USING ERRCODE='40001'; END IF;
    SELECT * INTO row FROM otl.community_chapters WHERE team_id=t AND slug=s;
    RETURN otl.community_chapter_json(row,false);
  END IF;
  RAISE EXCEPTION 'invalid chapter operation' USING ERRCODE='22023';
END $$;

CREATE FUNCTION otl.community_chapter_list(p jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,otl AS $$
  SELECT coalesce(jsonb_agg(otl.community_chapter_json(c,false) ORDER BY c.title,c.slug),'[]'::jsonb)
  FROM otl.community_chapters c WHERE c.team_id=p->>'teamId' AND c.state='active'
$$;

REVOKE ALL ON FUNCTION otl.community_chapter_json(otl.community_chapters,boolean),
  otl.community_chapter_execute(text,jsonb),otl.community_chapter_list(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION otl.community_chapter_list(jsonb) TO otl_guide_admin;

INSERT INTO otl.schema_migrations(version) VALUES('079-self-service-chapters');
COMMIT;
