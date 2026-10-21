import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare } from "miniflare";

// Real workerd + SQLite Durable Object RPC; only Neon/Slack are local fakes.
// No credentials loaded and every unexpected outbound request is rejected.
const temp = await mkdtemp(join(tmpdir(), "otl1-scrum-runtime-"));
const scriptPath = join(temp, "worker.js");
execFileSync("bun", ["build", "qa/fixtures/scrum-runtime.ts", "--target=browser", "--external=cloudflare:workers", `--outfile=${scriptPath}`]);
const records = new Map();
const posts = [];
const calls = [];
let blocked = false;
const mf = new Miniflare({
  modules: true, scriptPath, modulesRoot: temp, compatibilityDate: "2026-01-01",
  durableObjects: { COMMUNITY_CLOCK: { className: "CommunityClock", useSQLite: true } },
  bindings: {
    DATABASE_URL: "postgresql://qa:qa@example.neon.tech/test", SLACK_TEAM_ID: "TQA",
    SLACK_BOT_TOKEN: "test-token", COMMUNITY_ENABLED: "true", COMMUNITY_ADMIN_ID: "UADMIN",
    COMMUNITY_CHANNEL_ID: "CPUBLIC", COMMUNITY_PUBLIC_CHANNEL_ID: "CPUBLIC",
    COMMUNITY_MAINTAINERS_CHANNEL_ID: "CPO", COMMUNITY_FEEDBACK_CHANNEL_ID: "CFEEDBACK",
    COMMUNITY_INTRO_CHANNEL_ID: "CINTRO", BUG_RUNNER_ENABLED: "true", REVIEW_THREAD_V2: "true",
  },
  outboundService: async request => {
    const url = new URL(request.url);
    if (url.host === "slack.com" && url.pathname === "/api/emoji.list") return Response.json({ ok: true, emoji: {} });
    if (url.host === "slack.com" && url.pathname === "/api/chat.postMessage") {
      const message = await request.json(); posts.push(message);
      return Response.json({ ok: true, ts: `1791766800.${posts.length}` });
    }
    if (url.host !== "example.neon.tech") throw new Error(`unexpected outbound host: ${url.host}`);
    const {query, params} = await request.json();
    const reply = value => Response.json({ rows: [[value === null ? null : JSON.stringify(value)]] });
    if (query.includes("jsonb_build_object") && !query.includes("community_execute")) {
      calls.push("reminder_due_times");
      if (blocked) return new Response("database unavailable", {status:503});
      return reply({ goal: ["11:00"], review: ["20:00"] });
    }
    const op = query.includes("community_execute") ? params[0] : query;
    const p = JSON.parse(params.at(-1)); calls.push(op);
    if (blocked) return new Response("database unavailable", {status:503});
    if (op === "get_record") return reply(p.key === "group-schedule"
      ? { ...p, kind:"settings", status:"pending", body:{enabled:true,goalTime:"10:00",reviewTime:"18:00"} }
      : records.get(p.key) ?? null);
    if (op === "members") return reply(["UMEMBER"]);
    if (op === "put_record") {
      if (!records.has(p.key)) records.set(p.key, { ...p, status:"pending" });
      return reply(records.get(p.key));
    }
    if (query.includes("claim_common_delivery_v2")) {
      const r = [...records.values()].find(r=>r.kind === "dispatch" && r.status === "pending");
      if (!r) return reply(null);
      r.status = "claimed";
      return reply({ ...r.body, key:r.key, leaseToken:p.leaseToken, attempt:1, safeToPost:true, firstAttemptAt:p.now });
    }
    if (query.includes("finish_common_root")) {
      const r=records.get(`common:${p.date}:${p.kind}`); r.status="sent"; r.body.messageTs=p.messageTs;
      return reply(true);
    }
    if (op === "reminder_trigger_due") return reply(false);
    throw new Error(`unexpected database operation: ${op}`);
  },
});
try {
  const responses = await Promise.all([
    mf.dispatchFetch("https://test/?cron=*/5%20*%20*%20*%20*"), mf.dispatchFetch("https://test/"),
  ]);
  for (const response of responses) {
    assert.equal(response.status, 200);
    const state = await response.json();
    assert.equal(state.role, "daily_scrum");
    assert.equal(state.next, null, "no second alarm owner");
    assert.ok(["running", "finished"].includes(state.lastRun.status), "a concurrent invocation can already be running when inspect reads");
  }
  const settled = await (await mf.dispatchFetch("https://test/")).json();
  assert.equal(settled.lastRun.status, "finished");
  assert.equal(posts.length, 1, "overlapping exact/recovery invocations produce one root");
  assert.equal(posts[0].channel, "CPUBLIC");
  assert.match(posts[0].text, /2026-10-12 오늘의/);
  const actions = posts[0].blocks.flatMap(b=>b.elements??[]);
  assert.ok(actions.some(a=>a.action_id === "community_quick_goal"));
  assert.ok(actions.some(a=>a.action_id === "community_maintainer_activate"));
  assert.ok(!calls.some(c=>/maintainer|backfill|metadata/.test(c)), "no peripheral queries on the scrum lane");
  blocked = true;
  const failedResponse = await mf.dispatchFetch("https://test/?at=2026-10-13T01:00:00Z");
  assert.equal(failedResponse.status, 500, "Cron failure must remain visible to the platform alerts");
  const failed = await failedResponse.json();
  assert.equal(failed.lastRun.status, "failed");
  blocked = false;
  const recovered = await (await mf.dispatchFetch("https://test/?at=2026-10-13T01:05:00Z")).json();
  assert.equal(recovered.lastRun.status, "finished");
  assert.equal(posts.length, 2, "next Cron recovers after DB outage without losing the prior root");
  console.log("PASS workerd: scheduled handler -> isolated SQLite DO RPC -> scheduler -> Slack blocks; overlap and DB recovery");
} finally { await mf.dispose(); await rm(temp, {recursive:true,force:true}); }
