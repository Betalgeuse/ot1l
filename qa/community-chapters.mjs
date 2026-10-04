import assert from "node:assert/strict";
import {
  chapterCreateButton,
  createCommunityChapter,
  openCommunityChapterModal,
  parseCommunityChapter,
} from "../src/community-chapters.ts";

const calls = [];
let chapter = null;
const store = {
  async requestCommunityChapter(input) {
    if (!chapter)
      chapter = {
        ...input,
        createdBy: input.actorId,
        channelId: null,
        state: "creating",
        revision: 1,
        changed: true,
        announcementMessageTs: null,
        guideSynced: false,
      };
    return chapter;
  },
  async activateCommunityChapter(input) {
    chapter = { ...chapter, channelId: input.channelId, state: "active", revision: 2, changed: true };
    return chapter;
  },
  async markCommunityChapterAnnouncement(input) {
    chapter = { ...chapter, announcementMessageTs: input.messageTs, changed: false };
    return chapter;
  },
  async markCommunityChapterGuide() {
    chapter = { ...chapter, guideSynced: true, changed: false };
    return chapter;
  },
  async listCommunityChapters() {
    return chapter ? [chapter] : [];
  },
};
const context = {
  env: {
    SLACK_TEAM_ID: "TQA",
    SLACK_BOT_TOKEN: "xoxb-test",
    COMMUNITY_BOT_USER_ID: "UBOT",
    COMMUNITY_RELEASE_CHANNEL_ID: "CTOWNHALL1",
    COMMUNITY_WELCOME_CHANNEL_ID: "CWELCOME1",
    COMMUNITY_GUIDE_FILE_IDS: "FLOGO1,FDAILY2",
    COMMUNITY_GUIDE_CANVAS_ID: "FCANVAS01",
    COMMUNITY_GUIDE_CANVAS_URL: "https://example.slack.com/docs/TQA/FCANVAS01",
    COMMUNITY_GUIDE_ANCHOR_TS: "1790000000.100000",
    COMMUNITY_PUBLIC_CHANNEL_ID: "CPUBLIC001",
    COMMUNITY_FEEDBACK_CHANNEL_ID: "CFEEDBACK1",
    COMMUNITY_MAINTAINERS_CHANNEL_ID: "CMAINTAIN01",
    COMMUNITY_MAINTAINER_WORKSTREAM_CHANNEL_IDS: "CMAINEVENT1,CMAINWEB01,CMAINWELCOME1",
    COMMUNITY_SYS_ALERT_CHANNEL_ID: "CSYSALERT01",
    COMMUNITY_GUIDE_CHAPTER_CHANNEL_IDS: "CDEVELOP01,CENGLISH01,CSCIENT01",
  },
  store,
  scope: { teamId: "TQA", channelId: "CDEVELOP01", userId: "UCREATOR" },
  thread: "100.1",
  source: "100.2",
  date: "2026-10-03",
  key: "chapter-qa",
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const method = new URL(String(url)).pathname.split("/").at(-1);
  const payload = options.body ? JSON.parse(String(options.body)) : {};
  calls.push({ method, payload });
  if (method === "views.open") return Response.json({ ok: true });
  if (method === "conversations.list")
    return Response.json({
      ok: true,
      channels: [
        {
          id: "CARCHIVED",
          name: "chapter-ai-research",
          creator: "UBOT",
          is_archived: true,
        },
      ],
      response_metadata: { next_cursor: "" },
    });
  if (method === "conversations.create")
    return Response.json({ ok: true, channel: { id: "CNEWCHAPTER", name: "chapter-ai-research", creator: "UBOT" } });
  if (method === "chat.postEphemeral") return Response.json({ ok: true, message_ts: "300.1" });
  if (["conversations.setPurpose", "conversations.invite", "canvases.edit", "chat.update", "pins.add"].includes(method))
    return Response.json({ ok: true });
  if (method === "conversations.history") return Response.json({ ok: true, messages: [] });
  if (method === "chat.postMessage")
    return Response.json({ ok: true, ts: payload.channel === "CTOWNHALL1" ? "200.1" : "200.2" });
  throw new Error(`unexpected method ${method}`);
};

try {
  const button = chapterCreateButton();
  assert.equal(button.action_id, "community_chapter_open");
  assert.equal(button.text.text, "나도 관심주제 채널 만들기");
  await openCommunityChapterModal(context, "TRIGGER");
  const modal = calls.find((call) => call.method === "views.open").payload.view;
  assert.equal(modal.callback_id, "community_chapter_submit");
  assert.deepEqual(
    modal.blocks.filter((block) => block.type === "input").map((block) => block.block_id),
    ["title", "slug", "description"],
  );
  const parsed = parseCommunityChapter({
    state: { values: {
      title: { value: { value: "AI 연구 같이 보기" } },
      slug: { value: { value: "AI-Research" } },
      description: { value: { value: "논문과 실험을 함께 읽고 이야기해요." } },
    } },
  });
  assert.deepEqual(parsed, {
    title: "AI 연구 같이 보기",
    slug: "ai-research",
    description: "논문과 실험을 함께 읽고 이야기해요.",
  });
  const invalid = parseCommunityChapter({
    state: { values: {
      title: { value: { value: "A" } },
      slug: { value: { value: "잘못된 이름" } },
      description: { value: { value: "짧음" } },
    } },
  });
  assert.deepEqual(Object.keys(invalid.errors).sort(), ["description", "slug", "title"]);

  await createCommunityChapter(context, parsed);
  assert.equal(chapter.state, "active");
  assert.equal(chapter.channelId, "CNEWCHAPTER");
  assert.equal(chapter.announcementMessageTs, "200.1");
  assert.equal(chapter.guideSynced, true);
  assert.equal(calls.filter((call) => call.method === "conversations.create").length, 1);
  assert.equal(calls.filter((call) => call.method === "chat.postMessage" && call.payload.channel === "CTOWNHALL1").length, 1);
  const canvas = calls.find((call) => call.method === "canvases.edit").payload;
  assert.match(canvas.changes[0].document_content.markdown, /CNEWCHAPTER/);
  assert.match(canvas.changes[0].document_content.markdown, /논문과 실험/);

  await createCommunityChapter(context, parsed);
  assert.equal(calls.filter((call) => call.method === "conversations.create").length, 1);
  assert.equal(calls.filter((call) => call.method === "chat.postMessage" && call.payload.channel === "CTOWNHALL1").length, 1);
  console.log("PASS self-service Chapter: modal, validation, one channel, one Townhall notice, and dynamic guide sync");
} finally {
  globalThis.fetch = originalFetch;
}
