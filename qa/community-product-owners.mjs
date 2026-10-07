import assert from "node:assert/strict";
import {
  activateProductOwner,
  PRODUCT_OWNER_CHANNEL_GUIDE,
  productOwnerBoard,
  productOwnerMentionModal,
  productOwnerMentions,
} from "../src/community-product-owners.ts";

const calls = [];
const original = globalThis.fetch;
const env = {
  SLACK_BOT_TOKEN: "fake",
  SLACK_TEAM_ID: "TQA",
  DATABASE_URL: "postgresql://qa:synthetic@ep-qa.neon.tech/ot1l?sslmode=require",
  COMMUNITY_PO_CHANNEL_ID: "CPO",
  COMMUNITY_PO_WORK_CHANNEL_ID: "CWORK",
  COMMUNITY_PO_DESIGNER_CHANNEL_ID: "CDESIGN",
  COMMUNITY_PO_DEV_CHANNEL_ID: "CDEV",
  COMMUNITY_SYS_ALERT_CHANNEL_ID: "CALERT",
};
globalThis.fetch = async (url, options = {}) => {
  const parsed = JSON.parse(options.body);
  if (String(url).includes("ep-qa.neon.tech")) {
    const [op, payload] = parsed.params;
    if (op === "upsert")
      return Response.json({ fields: [{ name: "product_owner_execute" }], rows: [["true"]] });
    const role = JSON.parse(payload).role;
    const owners = [
      { userId: "UPO", displayName: "Owner", role: "po", expertise: ["제품 전략"] },
      { userId: "UDESIGN", displayName: "Designer", role: "po-designer", expertise: ["접근성"] },
      { userId: "UDEV", displayName: "Developer", role: "po-dev", expertise: ["Workers"] },
    ].filter((owner) => !role || owner.role === role);
    return Response.json({
      fields: [{ name: "product_owner_execute" }],
      rows: [[JSON.stringify(owners)]],
    });
  }
  const method = new URL(url).pathname.split("/").at(-1);
  calls.push({ method, body: parsed });
  return Response.json({ ok: true });
};
try {
  await activateProductOwner(env, {
    userId: "UPO",
    displayName: "Owner",
    role: "po",
    expertise: [" 제품 전략 ", "제품 전략"],
  });
  assert.deepEqual(
    calls.map((call) => call.body.channel),
    ["CPO", "CWORK", "CDESIGN", "CDEV", "CALERT"],
  );
  assert.match((await productOwnerBoard(env)).text, /@po-designer/);
  assert.equal(await productOwnerMentions(env, "po-dev"), "<@UDEV>");
  assert.deepEqual(
    productOwnerMentionModal().blocks[0].element.options.map((option) => option.value),
    ["po", "po-designer", "po-dev"],
  );
  for (const channel of [
    "#po:",
    "#po-work:",
    "#po-designer:",
    "#po-dev:",
    "#maintainers-sys-alert:",
  ])
    assert.ok(PRODUCT_OWNER_CHANNEL_GUIDE.includes(channel));
  console.log(
    "PASS Product Owner expertise, five-channel access, DB mentions, modal, guide and /po board",
  );
} finally {
  globalThis.fetch = original;
}
