import assert from "node:assert/strict";
import worker from "../event-site/src/index.ts";
import { validateOpenEventsConfig } from "../scripts/deploy-open-events-worker.mjs";

const env = { ASSETS: { async fetch() { throw new Error("assets are not served"); } } };

const health = await worker.fetch(new Request("https://events.example/health"), env);
assert.deepEqual(await health.json(), { status: "ok", service: "open-events", configured: true });
for (const [method, path] of [
  ["GET", `/events/schedule/${"a".repeat(40)}.${"b".repeat(64)}`],
  ["POST", "/bridge/state"],
  ["GET", "/event-schedule.js"],
  ["GET", "/"],
]) {
  const response = await worker.fetch(new Request(`https://events.example${path}`, { method }), env);
  assert.equal(response.status, 410, `${method} ${path} is closed`);
  assert.match(await response.text(), /모임 일정 기능은 종료되었습니다\. 모임은 Slack에서 안내합니다\./);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
}

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
console.log("PASS open events Worker serves only health and the closed notice, with guarded deploy config");
