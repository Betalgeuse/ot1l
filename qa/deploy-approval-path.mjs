import assert from "node:assert/strict";
import { mock } from "bun:test";
import { analyze, wranglerMain } from "../scripts/reach.mjs";

mock.module("cloudflare:workers", () => ({ DurableObject: class {} }));
const { DEPLOY_APPROVAL_ACTION_IDS, handleDeployApprovalAction } = await import(
  "../src/community-deploy-approval.ts"
);
const { authorizeCommunityAction } = await import("../src/community-permissions.ts");
const { communityInteraction } = await import("../src/community-interactions.ts");
const { actionIdentity } = await import("../src/community-runtime.ts");

const env = {
  SLACK_TEAM_ID: "TQA",
  COMMUNITY_ENABLED: "true",
  COMMUNITY_ADMIN_ID: "UADMIN",
  COMMUNITY_CHANNEL_ID: "CADMIN",
  COMMUNITY_PUBLIC_CHANNEL_ID: "CPUBLIC",
  COMMUNITY_MAINTAINERS_CHANNEL_ID: "CPO",
  DATABASE_URL: "postgresql://qa:qa@example.neon.tech/test",
  SLACK_BOT_TOKEN: "test",
};

// Every deploy approval action stays allowed for members and accepted from the PO channel.
for (const id of DEPLOY_APPROVAL_ACTION_IDS) {
  const scope = { teamId: "TQA", channelId: "CPO", userId: "UPO" };
  assert.doesNotThrow(() => authorizeCommunityAction(id, scope, env), `${id} must stay allowlisted`);
  const actor = { team: { id: "TQA" }, user: { id: "UPO" }, container: { channel_id: "CPO" } };
  assert.equal(actionIdentity(actor, env, id).channelId, "CPO", `${id} must be accepted in the PO channel`);
}
const founderDm = { team: { id: "TQA" }, user: { id: "UADMIN" }, container: { channel_id: "DFOUNDER" } };
assert.equal(actionIdentity(founderDm, env, "community_feedback_merge_approve").channelId, "DFOUNDER");

// The Slack route reaches the approval handler, not the unsupported-action error.
const click = (id, value, channel = "DFOUNDER") =>
  communityInteraction(
    {
      type: "block_actions",
      team: { id: "TQA" },
      user: { id: "UADMIN" },
      container: { channel_id: channel, message_ts: "1.000001" },
      actions: [{ action_id: id, value: JSON.stringify(value), action_ts: "1.000001" }],
    },
    env,
    () => {},
  );
await assert.rejects(
  click("community_feedback_merge_approve", { ownerId: "actor", key: "BUG-X" }),
  /병합 승인 대상/,
  "merge approval is routed to the deploy approval handler",
);
const linear = await click("community_linear_open", { ownerId: "actor", key: "x" }, "CPO");
assert.equal(linear?.status, 200);
assert.equal(
  await handleDeployApprovalAction("community_unknown", {}, "k", {}, null, () => {}),
  null,
);

// The approval path must be reachable from the real Worker entries, independent of intake files.
const { status } = analyze(process.cwd(), ["src/worker-entry.ts", ...wranglerMain(process.cwd())]);
for (const file of [
  "community-deploy-approval",
  "community-po-membership",
  "community-pr-metadata",
  "community-agent-notifications",
  "community-pull-request",
  "community-maintainer-work",
  "community-maintainer-store",
  "community-notification-thread",
  "community-work-thread",
])
  assert.notEqual(status.get(`src/${file}.ts`), "dead", `${file} is part of the deploy approval path`);
console.log("PASS deploy approval path: actions allowlisted, routed to the handler, modules reachable");
