import assert from "node:assert/strict";
import siteWorker from "../site/src/index.ts";

const snapshot = { metric: "weekly_distinct_recorders", timezone: "Asia/Seoul", as_of: "2026-11-13", status: "ok", weeks: [{ week_start: "2026-11-09", recorders: 2 }] };
const seen = [];
const env = {
  ASSETS: { async fetch() { throw new Error("metrics must not read assets"); } },
  CORE: { async fetch(request) { seen.push(new URL(request.url).pathname); return Response.json(snapshot); } },
  RATE_LIMITER: { async limit() { return { success: true }; } },
};
const response = await siteWorker.fetch(new Request("https://ot1l.hyuk.me/metrics/weekly-recorders?x=1"), env);
assert.equal(response.status, 200);
assert.deepEqual(seen, ["/metrics/weekly-recorders"]);
assert.equal(response.headers.get("content-type"), "application/json");
assert.deepEqual(await response.json(), snapshot);
const post = await siteWorker.fetch(new Request("https://ot1l.hyuk.me/metrics/weekly-recorders", { method: "POST" }), env).catch((error) => error);
assert.equal(seen.length, 1, "POST must not reach core");
assert.ok(post instanceof Error || post.status !== 200);
console.log("PASS site forwards the aggregate weekly recorders snapshot from core");
