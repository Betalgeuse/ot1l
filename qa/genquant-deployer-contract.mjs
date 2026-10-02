import assert from "node:assert/strict";
import { classifyRunnerDeploymentPaths, validateDeployerConfig } from "../automation/runner/genquant-deployer.mjs";

assert.equal(classifyRunnerDeploymentPaths([
  "automation/runner/contract.mjs",
  "automation/runner/genquant-runner.mjs",
  "qa/genquant-runner-contract.mjs",
  "docs/DEVELOPMENT.md",
]).automatic, true);
assert.deepEqual(classifyRunnerDeploymentPaths([
  "event-site/src/index.ts",
  "site/dist/event-schedule.js",
]), {
  automatic: true,
  adapter: "open-events",
  paths: ["event-site/src/index.ts", "site/dist/event-schedule.js"],
});
assert.equal(classifyRunnerDeploymentPaths(["src/community-townhall-events.ts"]).adapter, "core-worker");
assert.equal(classifyRunnerDeploymentPaths(["package.json"]).adapter, "core-worker");
for (const path of ["migrations/061.sql", "site/src/index.ts"])
  assert.equal(classifyRunnerDeploymentPaths([path]).automatic, false, path);
assert.deepEqual(classifyRunnerDeploymentPaths([]), { automatic: false, adapter: "manual", paths: [] });
assert.throws(() => validateDeployerConfig({}), /missing deployer config/);
assert.equal(validateDeployerConfig({
  BUG_RUNNER_DATABASE_URL: "postgresql://u:p@example.neon.tech/db",
  SLACK_TEAM_ID: "TQA",
  CODEX_REPOSITORY_URL: "https://github.com/Betalgeuse/ot1l.git",
  CODEX_BASE_BRANCH: "main",
  BUG_DEPLOY_CHECKOUT: "/home/opc/otl1-bug-runner/current",
  BUG_DEPLOY_SERVICE: "otl1-bug-runner.service",
}).BUG_DEPLOY_SERVICE, "otl1-bug-runner.service");
console.log("PASS GenQuant deployer path policy and configuration contract");
