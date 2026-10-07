import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyChangePaths } from "../automation/runner/change-policy.mjs";
import { verifySlackPresentationBoundary } from "../automation/runner/slack-presentation-boundary.mjs";

const actualPath = "src/slack-presentation/product-owner.ts";
assert.deepEqual(classifyChangePaths([actualPath]), {
  changeClass: "open",
  adapter: "core-worker",
  paths: [actualPath],
});
for (const corePath of [
  "src/community-feedback.ts",
  "src/community-maintainers.ts",
  "migrations/086_product_owner_groups.sql",
  "wrangler.jsonc",
  "automation/runner/genquant-runner.mjs",
]) assert.equal(classifyChangePaths([actualPath, corePath]).changeClass, "core");

assert.deepEqual(verifySlackPresentationBoundary(process.cwd(), [actualPath]), [actualPath]);

const root = mkdtempSync(join(tmpdir(), "otl1-presentation-boundary-"));
mkdirSync(join(root, "src/slack-presentation"), { recursive: true });
cpSync(actualPath, join(root, actualPath));
const forbidden = new Map([
  ["import { x } from '../core';", "import"],
  ["export const x = process.env.SECRET;", "environment"],
  ["export const x = fetch('/api');", "fetch"],
  ["export const x = DATABASE_URL;", "secret"],
  ["export const x = queryJson('select 1');", "database"],
  ["export const x = callSlack('chat.postMessage');", "api"],
  ["export const x = { action_id: 'route' };", "routing"],
  ["export const x = member.role;", "member_or_role"],
  ["export const x = real_name;", "pii"],
  ["export const x = 'Deployment Broker';", "broker"],
]);
for (const [source, error] of forbidden) {
  writeFileSync(join(root, actualPath), source);
  assert.throws(() => verifySlackPresentationBoundary(root, [actualPath]), new RegExp(error, "i"));
}

console.log("PASS Slack presentation Open boundary and Core fail-closed fixtures");
