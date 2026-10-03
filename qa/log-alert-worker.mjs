import assert from "node:assert/strict";
import { handleLogAlerts, safeLogIncident } from "../src/log-alert-worker.ts";

const calls = [];
let limiterSuccess = true;
const env = {
  SLACK_BOT_TOKEN: "xoxb-test",
  COMMUNITY_SYS_ALERT_CHANNEL_ID: "CSYSALERT",
  ALERT_RATE_LIMITER: {
    async limit(input) {
      calls.push({ method: "limit", body: input });
      return { success: limiterSuccess };
    },
  },
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const body = options.body ? JSON.parse(options.body) : {};
  calls.push({ method: new URL(url).pathname.split("/").at(-1), body });
  return Response.json({ ok: true, ts: "1.000001" });
};
const trace = (overrides = {}) => ({
  event: {
    request: {
      method: "GET",
      url: "https://example.com/events/signed-secret-token?token=private",
      headers: { authorization: "Bearer private-token", cookie: "session=private" },
      getUnredacted() {
        throw new Error("must not read unredacted request");
      },
    },
    response: { status: 200 },
  },
  eventTimestamp: Date.now(),
  logs: [{ timestamp: Date.now(), level: "error", message: "database password=private" }],
  exceptions: [],
  diagnosticsChannelEvents: [],
  scriptName: "otl1-onething-garden",
  outcome: "ok",
  executionModel: "stateless",
  truncated: false,
  cpuTime: 1,
  wallTime: 2,
  ...overrides,
});

try {
  assert.equal(safeLogIncident(trace()), null, "successful requests stay silent");
  assert.equal(await handleLogAlerts([trace()], env), 0);
  assert.equal(calls.some((call) => call.method === "chat.postMessage"), false);

  const serverError = trace({
    event: { ...trace().event, response: { status: 503 } },
    exceptions: [
      { timestamp: Date.now(), name: "Error", message: "token=secret", stack: "private stack" },
    ],
  });
  assert.equal(await handleLogAlerts([serverError], env), 1);
  const post = calls.find((call) => call.method === "chat.postMessage");
  assert.equal(post.body.channel, "CSYSALERT");
  assert.match(post.body.text, /otl1-onething-garden/);
  assert.match(post.body.text, /HTTP 503/);
  assert.match(post.body.text, /예외: 1개/);
  assert.doesNotMatch(
    JSON.stringify(post.body),
    /signed-secret-token|private-token|password|token=secret|private stack|authorization|cookie/i,
  );

  calls.length = 0;
  limiterSuccess = false;
  assert.equal(await handleLogAlerts([serverError], env), 0);
  assert.equal(calls.some((call) => call.method === "chat.postMessage"), false);
  console.log("PASS Tail Worker: real failure signals reach Slack while request and raw logs stay out");
} finally {
  globalThis.fetch = originalFetch;
}
