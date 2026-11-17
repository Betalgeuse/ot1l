import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { handleOctoDecisionWebhook, purgeDecisionWebhookReceipts } from "../src/octo-decision-webhook.ts";

// Fake Neon HTTP endpoint that mirrors otl.octo_decision_receipt_record/purge. No network.
const rows = new Map();
let failDb = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (_url, init) => {
  if (failDb) return new Response("{}", { status: 500 });
  const { query, params } = JSON.parse(init.body);
  let out;
  if (query.includes("octo_decision_receipt_record")) {
    const p = JSON.parse(params[0]);
    const stale = [...rows.values()].some((r) => r.decisionId === p.decisionId && r.version >= p.version);
    if (stale || rows.has(p.webhookId)) out = { status: "duplicate" };
    else {
      rows.set(p.webhookId, p);
      out = { status: "accepted" };
    }
  } else if (query.includes("octo_decision_receipt_purge")) out = { purged: 0 };
  else throw new Error(`unexpected query ${query}`);
  return Response.json({ rows: [[JSON.stringify(out)]] });
};

const key = randomBytes(32);
const secret = `whsec_${key.toString("base64")}`;
const env = { DATABASE_URL: "postgres://u:p@ep-test.neon.tech/db", OCTO_DECISION_WEBHOOK_SECRET: secret };
const NOW = 1_800_000_000_000;
const sign = (id, ts, body, k = key) => `v1,${createHmac("sha256", k).update(`${id}.${ts}.${body}`).digest("base64")}`;
const payload = (decisionId = "d1", version = 1) =>
  JSON.stringify({
    type: "decision.made",
    timestamp: "2027-01-15T08:00:00Z",
    data: { decision_id: decisionId, approval_ref: "a1", unit: "otl1", intent: "i", choice: "yes", via: "tower", effect: { name: "note", extra: 1 }, version },
  });
async function post(id, body, { ts = NOW / 1000, sig, e = env } = {}) {
  const headers = { "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": sig ?? sign(id, ts, body) };
  return handleOctoDecisionWebhook(new Request("https://w.example/octo/decisions", { method: "POST", headers, body }), e, () => NOW);
}

let res = await post("msg_1", payload());
assert.equal(res.status, 202);
assert.deepEqual(await res.json(), { status: "accepted", webhook_id: "msg_1" });
assert.equal(rows.size, 1);

res = await post("msg_1", payload());
assert.equal(res.status, 200);
assert.deepEqual(await res.json(), { status: "duplicate" });
assert.equal(rows.size, 1);

rows.clear();
res = await post("msg_2", payload(), { sig: sign("msg_2", NOW / 1000, payload(), randomBytes(32)) });
assert.equal(res.status, 401);
assert.equal(rows.size, 0);

res = await post("msg_3", payload(), { ts: NOW / 1000 - 301 });
assert.equal(res.status, 401);
assert.equal(rows.size, 0);
assert.equal((await post("msg_3b", payload(), { ts: NOW / 1000 - 299 })).status, 202);
rows.clear();

const body4 = payload();
const bad = sign("msg_4", NOW / 1000, body4, randomBytes(32));
res = await post("msg_4", body4, { sig: `${bad} ${sign("msg_4", NOW / 1000, body4)}` });
assert.equal(res.status, 202, "rotation: second signature valid");
rows.clear();

assert.equal((await post("msg_5", payload("d9", 5))).status, 202);
res = await post("msg_6", payload("d9", 4));
assert.equal(res.status, 200);
assert.deepEqual(await res.json(), { status: "duplicate" });
assert.equal(rows.size, 1);
assert.equal((await post("msg_7", payload("d9", 6))).status, 202);
assert.equal(rows.size, 2);

// 400: bad JSON, missing version, wrong type, missing header
const signedBad = (id, b) => post(id, b);
assert.equal((await signedBad("b1", "{nope")).status, 400);
assert.equal((await signedBad("b2", JSON.stringify({ type: "x", timestamp: "t", data: { decision_id: "d" } }))).status, 400);
assert.equal((await signedBad("b3", JSON.stringify({ type: 1, data: {} }))).status, 400);
const noHeaders = await handleOctoDecisionWebhook(new Request("https://w.example/octo/decisions", { method: "POST", body: "{}" }), env, () => NOW);
assert.equal(noHeaders.status, 400);
const withData = (patch) => JSON.stringify({ type: "decision.made", timestamp: "2027-01-15T08:00:00Z", data: { decision_id: "dx", approval_ref: "a", unit: "u", intent: "i", choice: "c", via: "tower", effect: { name: "note" }, version: 1, ...patch } });
assert.equal((await signedBad("e1", withData({ effect: "note" }))).status, 400);
assert.equal((await signedBad("e2", withData({ effect: null }))).status, 400);
assert.equal((await signedBad("e3", withData({ effect: {} }))).status, 400);
assert.equal((await signedBad("e4", withData({ effect: { name: "x".repeat(65) } }))).status, 400);
assert.equal((await signedBad("e5", JSON.stringify({ type: "decision.resolved", timestamp: "t", data: {} }))).status, 400);
assert.equal((await signedBad("e6", JSON.stringify({ ...JSON.parse(withData({})), timestamp: 5 }))).status, 400);
assert.equal(rows.size, 2);

assert.equal((await signedBad("v1", withData({ version: 2147483648 }))).status, 400);
assert.equal((await signedBad("v2", withData({ version: -1 }))).status, 400);
assert.equal((await signedBad("v3", withData({ version: 2147483647 }))).status, 202);
const hangul = "가".repeat(6000);
assert.ok(hangul.length < 16384 && new TextEncoder().encode(hangul).length > 16384);
assert.equal((await signedBad("big", withData({ intent: hangul }))).status, 400);
for (const bad of ["whsec_!!!not-base64!!!", "whsec_", "whsec_AAAA"]) {
  const r = await post("m1", payload("dm"), { e: { ...env, OCTO_DECISION_WEBHOOK_SECRET: bad }, sig: "v1,AAAA" });
  assert.equal(r.status, bad === "whsec_AAAA" ? 401 : 503, bad);
}

// 503: secret unset, DB failure
assert.equal((await post("s1", payload(), { e: { ...env, OCTO_DECISION_WEBHOOK_SECRET: undefined } })).status, 503);
failDb = true;
assert.equal((await post("s2", payload("d77"))).status, 503);
failDb = false;
assert.equal(rows.size, 3);

await purgeDecisionWebhookReceipts({ queryJson: async (q) => { assert.match(q, /purge/); return { purged: 0 }; } });
globalThis.fetch = realFetch;
console.log("PASS octo decision webhook receipts");
