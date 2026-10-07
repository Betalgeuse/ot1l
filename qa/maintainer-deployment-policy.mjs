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
assert.deepEqual(
  classifyChangePaths([
    "src/slack-presentation/merge-ready.ts",
    "qa/slack-presentation/merge-ready.mjs",
  ]),
  {
    changeClass: "open",
    adapter: "slack-presentation",
    paths: [
      "qa/slack-presentation/merge-ready.mjs",
      "src/slack-presentation/merge-ready.ts",
    ],
  },
);
for (const path of [
  "src/community-interactions.ts",
  "src/community-runtime.ts",
  "src/community-maintainer-store.ts",
  "migrations/086_product_owner_groups.sql",
  "wrangler.jsonc",
  "automation/runner/genquant-runner.mjs",
]) assert.equal(classifyChangePaths([path]).changeClass, "core", `${path} must remain Core`);
assert.equal(
  classifyChangePaths([
    "src/slack-presentation/merge-ready.ts",
    "src/community-interactions.ts",
  ]).changeClass,
  "core",
  "presentation mixed with interaction routing must fail closed",
);
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
