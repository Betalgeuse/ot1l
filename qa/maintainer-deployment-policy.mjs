import assert from "node:assert/strict";
import { classifyChangePaths } from "../automation/runner/change-policy.mjs";

assert.deepEqual(
  classifyChangePaths([
    "event-site/src/index.ts",
    "event-site/wrangler.jsonc",
    "site/dist/event-schedule.html",
    "site/dist/event-schedule.js",
  ]),
  {
    changeClass: "open",
    adapter: "open-events",
    paths: [
      "event-site/src/index.ts",
      "event-site/wrangler.jsonc",
      "site/dist/event-schedule.html",
      "site/dist/event-schedule.js",
    ],
  },
);
assert.deepEqual(classifyChangePaths(["src/community-runtime.ts"]), {
  changeClass: "core",
  adapter: "core-worker",
  paths: ["src/community-runtime.ts"],
});
assert.equal(
  classifyChangePaths(["event-site/src/index.ts", "migrations/067_flexible_townhall_event.sql"])
    .changeClass,
  "core",
);
assert.equal(classifyChangePaths(["site/src/index.ts"]).adapter, "manual");
assert.equal(classifyChangePaths(["automation/runner/genquant-runner.mjs"]).adapter, "runner");
assert.equal(
  classifyChangePaths(["event-site/src/index.ts", "src/community-runtime.ts"])
    .changeClass,
  "core",
);
console.log("PASS maintainer deployment policy: Open isolation, Founder Core deploy, mixed paths fail closed");
