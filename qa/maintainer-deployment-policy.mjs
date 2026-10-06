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
  classifyChangePaths(["docs/EVENTS_AND_MAINTAINERS.md", "src/community-runtime.ts"]).adapter,
  "core-worker",
);
assert.equal(
  classifyChangePaths(["event-site/src/index.ts", "migrations/067_flexible_townhall_event.sql"])
    .changeClass,
  "core",
);
assert.equal(classifyChangePaths(["site/src/index.ts"]).adapter, "site");
assert.equal(
  classifyChangePaths([
    "migrations/084_slack_native_maintainer_work.sql",
    "src/community-maintainer-work.ts",
    "site/src/index.ts",
  ]).adapter,
  "core-stack",
);
assert.equal(classifyChangePaths(["automation/runner/genquant-runner.mjs"]).adapter, "runner");
assert.equal(
  classifyChangePaths(["event-site/src/index.ts", "src/community-runtime.ts"])
    .changeClass,
  "core",
);
console.log("PASS deployment policy: Open isolation plus Founder-only Core, site and ordered Core stack adapters");
