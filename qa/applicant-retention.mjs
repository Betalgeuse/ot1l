import assert from "node:assert/strict";
import { runApplicantRetention } from "../src/community-applicant-retention.ts";

const now = Date.parse("2026-11-13T00:00:00.000Z");
const deleted = [];
const bucket = { async delete(key) { deleted.push(key); if (key.includes("fail")) throw new Error("r2"); } };
const referralRows = [
  { requestId: "REQ-1", claimKey: "ck1", opaqueRef: "invite-private/a" },
  { requestId: "REQ-2", claimKey: "ck2", opaqueRef: "invite-private/fail" },
];
const referralCalls = [];
const referralDb = {
  async queryJson(sql, [payload]) {
    const op = /'(\w+)'/.exec(sql)[1];
    const body = JSON.parse(payload);
    referralCalls.push({ op, body });
    return op === "claim_purge" ? (referralRows.shift() ?? null) : true;
  },
};
const interestRows = [{ interestId: "IREQ-ABCD", opaqueRef: "interest-private/IREQ-ABCD/revision-0-abc-def.enc" }];
const interestCalls = [];
const interestDb = {
  async queryJson(_sql, [op, payload]) {
    const body = JSON.parse(payload);
    interestCalls.push({ op, body });
    return op === "claim_purge" ? (interestRows.shift() ?? null) : true;
  },
};
const env = {
  SLACK_TEAM_ID: "TQA",
  INVITE_PRIVATE_OBJECTS: bucket,
  INTEREST_RUNTIME_DATABASE_URL: "postgres://interest",
  REFERRALS_ENABLED: "false",
  PUBLIC_INTEREST_ENABLED: "false",
};

const result = await runApplicantRetention(env, referralDb, now, () => interestDb);
assert.deepEqual(result, { possiblyMore: false, failed: false }, "flags closed still purges");
assert.deepEqual(deleted, ["invite-private/a", "invite-private/fail", "interest-private/IREQ-ABCD/revision-0-abc-def.enc"]);
assert.deepEqual(
  referralCalls.filter((c) => c.op === "finish_purge").map((c) => [c.body.requestId, c.body.status]),
  [["REQ-1", "purged"], ["REQ-2", "failed"]],
  "a failed R2 delete is recorded as failed, never purged",
);
assert.deepEqual(interestCalls.map((c) => c.op), ["expire_due", "claim_purge", "finish_purge", "claim_purge", "audit_retention"]);
assert.equal(interestCalls.find((c) => c.op === "finish_purge").body.status, "purged");

// An interest object path outside the private prefix is never deleted and is recorded failed.
deleted.length = 0;
interestCalls.length = 0;
interestRows.push({ interestId: "IREQ-ABCD", opaqueRef: "../other/object" });
await runApplicantRetention(env, { queryJson: async () => null }, now, () => interestDb);
assert.deepEqual(deleted, []);
assert.equal(interestCalls.find((c) => c.op === "finish_purge").body.status, "failed");

// Missing bucket is a reported failure that retries, not a silent success.
const errors = [];
const originalError = console.error;
console.error = (line) => errors.push(JSON.parse(line));
try {
  const missing = await runApplicantRetention({ SLACK_TEAM_ID: "TQA" }, referralDb, now, () => interestDb);
  assert.equal(missing.failed, true);
} finally {
  console.error = originalError;
}
assert.deepEqual(errors.map((e) => e.queue), ["referral_purge", "interest_purge"]);
assert.ok(errors.every((e) => e.errorCode === "configuration" && !("message" in e)));
console.log("PASS applicant retention purges expired payloads with flags closed and reports failures");
