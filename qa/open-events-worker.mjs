import assert from "node:assert/strict";
import worker from "../event-site/src/index.ts";
import { validateOpenEventsConfig } from "../scripts/deploy-open-events-worker.mjs";

const token = `${"a".repeat(40)}.${"b".repeat(64)}`;
const calls = [];
const env = {
  ASSETS: {
    async fetch(request) {
      if (new URL(request.url).pathname === "/event-schedule.html")
        return new Response('<body data-event-token="__EVENT_TOKEN__">');
      return new Response("not found", { status: 404 });
    },
  },
  CORE: {
    async fetch(request) {
      calls.push({ path: new URL(request.url).pathname, headers: request.headers, body: await request.json() });
      return Response.json({ event: { eventId: "VEVENT-1" } });
    },
  },
  RATE_LIMITER: { async limit() { return { success: true }; } },
  EVENT_CORE_HMAC_SECRET: "event-only-secret",
};

const health = await worker.fetch(new Request("https://events.example/health"), env);
assert.deepEqual(await health.json(), { status: "ok", service: "open-events", configured: true });
const page = await worker.fetch(new Request(`https://events.example/events/schedule/${token}`), env);
assert.equal(page.status, 200);
assert.match(await page.text(), new RegExp(token.replaceAll(".", "[.]")));
assert.equal(
  await worker
    .fetch(new Request("https://events.example/event-schedule.css"), {
      ...env,
      ASSETS: { async fetch() { return new Response("event css"); } },
    })
    .then((response) => response.text()),
  "event css",
);
assert.equal(
  await worker
    .fetch(new Request("https://events.example/styles.css"), env)
    .then((response) => response.status),
  404,
);
const state = await worker.fetch(new Request("https://events.example/bridge/state", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ token }),
}), env);
assert.equal(state.status, 200);
assert.equal(calls[0].path, "/internal/events/state");
assert.equal(calls[0].body.token, token);
assert.match(calls[0].headers.get("x-otl-signature"), /^[0-9a-f]{64}$/);
assert.equal(
  await worker
    .fetch(
      new Request("https://events.example/api/events/schedule/state", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      }),
      env,
    )
    .then((response) => response.status),
  404,
);

const config = {
  name: "otl1-time",
  main: "event-site/src/index.ts",
  assets: { directory: "site/dist" },
  services: [{ binding: "CORE", service: "otl1-onething-garden" }],
};
assert.equal(validateOpenEventsConfig(config), config);
assert.throws(() => validateOpenEventsConfig({ ...config, name: "otl1-onething-garden" }), /name mismatch/);
assert.throws(() => validateOpenEventsConfig({ ...config, services: [] }), /binding missing/);
assert.throws(() => validateOpenEventsConfig({ ...config, services: [{ binding: "CORE", service: "replace-with-core" }] }), /placeholders/);
console.log("PASS open events Worker has event-only proxy, health, assets, and guarded deploy config");
