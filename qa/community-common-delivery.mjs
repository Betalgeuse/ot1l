import assert from "node:assert/strict";
import { sendCommonDeliveries } from "../src/community-common-delivery.ts";
import { memberActionBlocks } from "../src/community-member-actions.ts";

const memberActions = memberActionBlocks({}, "2026-09-18");
assert.deepEqual(
  memberActions.at(-1).elements.map((element) => element.action_id),
  ["community_bug_open", "community_maintainer_activate"],
);
assert.deepEqual(
  memberActions.at(-1).elements.map((element) => element.style),
  ["primary", "primary"],
);
assert.ok(
  memberActions.flatMap((block) => block.elements).every((element) => !element.text.text.includes("자기소개")),
);

const scope = { teamId: "TQA", channelId: "CPUBLIC", userId: "UADMIN" };
const text = "stable common payload <@U1>";
const originalFetch = globalThis.fetch;
try {
  const failures = [];
  let firstClaim = true;
  const rateStore = {
    async claimCommonDelivery() {
      if (!firstClaim) return null;
      firstClaim = false;
      return {
        leaseToken: "rate",
        attempt: 1,
        safeToPost: true,
        firstAttemptAt: "2026-09-18T01:00:00Z",
        key: "common:2026-09-18:goal",
        text,
        date: "2026-09-18",
        kind: "goal",
      };
    },
    async finishCommonDelivery(value) {
      failures.push(value);
      return true;
    },
    async putRecord() {
      throw new Error("unexpected record");
    },
  };
  globalThis.fetch = async () =>
    new Response("", { status: 429, headers: { "Retry-After": "23" } });
  assert.equal(
    await sendCommonDeliveries({
      token: "token",
      now: "2026-09-18T01:00:00Z",
      scope,
      store: rateStore,
    }),
    0,
  );
  assert.deepEqual(failures, [
    {
      ...scope,
      leaseToken: "rate",
      status: "failed",
      errorCode: "rate_limited",
      retryAfterSeconds: 23,
    },
  ]);

  const records = [];
  const finishes = [];
  let historyPages = 0;
  let posts = 0;
  let retryClaimed = false;
  const retryStore = {
    async claimCommonDelivery() {
      if (retryClaimed) return null;
      retryClaimed = true;
      return {
        leaseToken: "retry",
        attempt: 2,
        safeToPost: false,
        firstAttemptAt: "2026-09-18T01:00:00Z",
        key: "common:2026-09-18:goal",
        text,
        date: "2026-09-18",
        kind: "goal",
      };
    },
    async finishCommonRoot(value) { records.push(value); return true; },
    async finishCommonDelivery(value) {
      finishes.push(value);
      return true;
    },
  };
  globalThis.fetch = async (url) => {
    const method = new URL(url).pathname.split("/").at(-1);
    if (method === "conversations.history") {
      historyPages += 1;
      return historyPages === 1
        ? Response.json({ ok: true, messages: [], response_metadata: { next_cursor: "page-2" } })
        : Response.json({
            ok: true,
            messages: [{ ts: "200.2", text }],
            response_metadata: { next_cursor: "" },
          });
    }
    posts += 1;
    return Response.json({ ok: true, ts: "unexpected" });
  };
  assert.equal(
    await sendCommonDeliveries({
      token: "token",
      now: "2026-09-18T01:05:00Z",
      scope,
      store: retryStore,
    }),
    1,
  );
  assert.equal(historyPages, 2);
  assert.equal(posts, 0);
  assert.deepEqual(records, [{
    ...scope, leaseToken: "retry", date: "2026-09-18", kind: "goal",
    messageTs: "200.2", bindReview: false,
  }]);
  assert.deepEqual(finishes, []);

  const interruptedFinishes = [];
  let interruptedClaimed = false;
  const interruptedStore = {
    async claimCommonDelivery() {
      if (interruptedClaimed) return null;
      interruptedClaimed = true;
      return {
        leaseToken: "interrupted",
        attempt: 1,
        safeToPost: true,
        firstAttemptAt: "2026-09-28T01:00:00Z",
        key: "common:2026-09-28:goal",
        text,
        date: "2026-09-28",
        kind: "goal",
      };
    },
    async finishCommonRoot() {
      throw new TypeError("simulated post-receipt interruption");
    },
    async finishCommonDelivery(value) {
      interruptedFinishes.push(value);
      return true;
    },
  };
  globalThis.fetch = async () => Response.json({ ok: true, ts: "300.3" });
  assert.equal(
    await sendCommonDeliveries({
      token: "token",
      now: "2026-09-28T01:00:00Z",
      scope,
      store: interruptedStore,
    }),
    0,
  );
  assert.deepEqual(interruptedFinishes, [
    { ...scope, leaseToken: "interrupted", status: "failed", errorCode: "transport_error" },
  ]);

  let uncertainClaims = 0;
  let uncertainPosts = 0;
  const uncertainFinishes = [];
  const uncertainStore = {
    async claimCommonDelivery() {
      if (uncertainClaims++) return null;
      return {
        leaseToken: "uncertain", attempt: 2, safeToPost: false,
        firstAttemptAt: "2026-10-02T01:00:35Z", key: "common:2026-10-02:goal",
        text, date: "2026-10-02", kind: "goal",
      };
    },
    async finishCommonDelivery(value) { uncertainFinishes.push(value); return true; },
    async finishCommonRoot() { throw new Error("must not finalize an absent receipt"); },
  };
  globalThis.fetch = async (url) => {
    const method = new URL(url).pathname.split("/").at(-1);
    if (method === "conversations.history")
      return Response.json({ ok: true, messages: [], response_metadata: { next_cursor: "" } });
    uncertainPosts += 1;
    return Response.json({ ok: true, ts: "must-not-post" });
  };
  assert.equal(await sendCommonDeliveries({
    token: "token", now: "2026-10-02T01:05:35Z", scope, store: uncertainStore,
  }), 0);
  assert.equal(uncertainPosts, 0, "an uncertain retry must not create a duplicate Slack post");
  assert.equal(uncertainFinishes[0].errorCode, "history_incomplete");
  console.log(
    "PASS common delivery: bounded retry, interrupted receipt recovery, and history reconciliation prevent lost posts",
  );
} finally {
  globalThis.fetch = originalFetch;
}
