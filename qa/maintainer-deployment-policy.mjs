import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyChangePaths,
  verifySlackPresentationBoundary,
} from "../automation/runner/change-policy.mjs";

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
assert.deepEqual(classifyChangePaths(["src/slack-presentation/approval-card.ts"]), {
  changeClass: "open",
  adapter: "core-worker",
  paths: ["src/slack-presentation/approval-card.ts"],
});
assert.equal(
  classifyChangePaths([
    "src/slack-presentation/approval-card.ts",
    "src/community-runtime.ts",
  ]).changeClass,
  "core",
);

const checkout = mkdtempSync(join(tmpdir(), "otl1-slack-presentation-"));
mkdirSync(join(checkout, "src/slack-presentation"), { recursive: true });
const presentation = join(checkout, "src/slack-presentation/approval-card.ts");
writeFileSync(presentation, "export const card = (label: string) => ({ type: 'button', text: label });\n");
verifySlackPresentationBoundary(checkout, ["src/slack-presentation/approval-card.ts"]);
for (const [source, expected] of [
  ["import { env } from '../runtime';", "imports"],
  ["fetch(url);", "network access"],
  ["const secret = process.env.TOKEN;", "environment access"],
  ["const rows = db.query(statement);", "database access"],
  ["router.post('/approve', handler);", "routing access"],
]) {
  writeFileSync(presentation, `${source}\n`);
  assert.throws(
    () => verifySlackPresentationBoundary(checkout, ["src/slack-presentation/approval-card.ts"]),
    new RegExp(expected),
  );
}
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
