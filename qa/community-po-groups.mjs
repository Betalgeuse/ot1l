import assert from "node:assert/strict";
import { openPoSpecialties, openPoSummon, submitPoSummon } from "../src/community-po-groups.ts";

const calls = [];
const context = {
  env: { SLACK_BOT_TOKEN: "fake" },
  scope: { teamId: "TQA", channelId: "CPO", userId: "UMEMBER" },
  source: "1790000000.000001",
  thread: "1790000000.000001",
  date: "2026-10-07",
  store: {
    async maintainerAudiences() {
      return { po: ["UPO1", "UPO2"], designer: ["UPO2"], dev: ["UPO3"] };
    },
  },
};
const original = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const method = new URL(url).pathname.split("/").at(-1);
  const body = JSON.parse(options.body ?? "{}");
  calls.push({ method, body });
  return Response.json({ ok: true, ts: "1790000001.000001" });
};
try {
  await openPoSpecialties(context, "trigger");
  await openPoSummon(context, "trigger");
  const views = calls.filter((call) => call.method === "views.open");
  assert.equal(views[0].body.view.blocks[0].element.type, "checkboxes");
  assert.equal(views[1].body.view.blocks[1].optional, undefined);
  const view = {
    state: {
      values: {
        audiences: { value: { selected_options: [{ value: "po" }, { value: "designer" }] } },
        reason: { value: { value: "새 온보딩 화면을 함께 확인해 주세요." } },
      },
    },
  };
  assert.equal(await submitPoSummon(context, view), null);
  const posted = calls.find((call) => call.method === "chat.postMessage").body;
  assert.equal(posted.thread_ts, context.thread);
  assert.equal(posted.text, "<@UPO1> <@UPO2>\n새 온보딩 화면을 함께 확인해 주세요.");
  assert.doesNotMatch(posted.text, /@po(?:-|\b)/);
  console.log(
    "PASS PO specialty checkboxes and thread summon resolve only deduplicated Slack user IDs",
  );
} finally {
  globalThis.fetch = original;
}
