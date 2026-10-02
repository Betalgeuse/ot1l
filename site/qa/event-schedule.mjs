import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.ts";

const token = `${"a".repeat(40)}.${"b".repeat(64)}`;
const calls = [];
const env = {
  ASSETS: {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/event-schedule.html")
        return new Response('<body data-event-token="__EVENT_TOKEN__"><script src="/event-schedule.js"></script>');
      return new Response("not found", { status: 404 });
    },
  },
  CORE: {
    async fetch(request) {
      calls.push({ path: new URL(request.url).pathname, body: await request.json(), headers: request.headers });
      return Response.json({ event: { eventId: "VEVENT-1" } });
    },
  },
  RATE_LIMITER: { async limit() { return { success: true }; } },
  TURNSTILE_SITE_KEY: "unused",
  SITE_CORE_HMAC_SECRET: "site-secret",
  EVENT_CORE_HMAC_SECRET: "event-secret",
};

const page = await worker.fetch(new Request(`https://ot1l.hyuk.me/events/schedule/${token}`), env);
assert.equal(page.status, 200);
assert.match(await page.text(), new RegExp(token.replaceAll(".", "[.]")));
const state = await worker.fetch(new Request("https://ot1l.hyuk.me/bridge/state", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }),
}), env);
assert.equal(state.status, 200);
assert.equal(calls[0].path, "/internal/events/state");
assert.equal(calls[0].body.token, token);
assert.match(calls[0].headers.get("x-otl-signature"), /^[0-9a-f]{64}$/);
assert.match(readFileSync("site/dist/event-schedule.html", "utf8"), /data-duration/);
assert.match(readFileSync("site/dist/event-schedule.js", "utf8"), /durationMinutes/);
assert.doesNotMatch(readFileSync("site/dist/event-schedule.js", "utf8"), /api\/events\/schedule/);
assert.match(readFileSync("site/dist/event-schedule.js", "utf8"), /activity[.]split\("\\n"\)\[0\]/);
assert.match(readFileSync("site/dist/event-schedule.html", "utf8"), /event-schedule[.]js[?]v=20261003-2/);
console.log("PASS event schedule site serves signed page and proxies only signed Core requests");
