import assert from "node:assert/strict";
import { classifyRunnerDeploymentPaths, validateDeployerConfig } from "../automation/runner/genquant-deployer.mjs";

assert.equal(classifyRunnerDeploymentPaths([
  "automation/runner/contract.mjs",
  "automation/runner/genquant-runner.mjs",
  "qa/genquant-runner-contract.mjs",
  "docs/DEVELOPMENT.md",
]).automatic, true);
for (const path of ["src/community-scheduler.ts", "migrations/061.sql", "site/src/index.ts", "package.json"])
  assert.equal(classifyRunnerDeploymentPaths([path]).automatic, false, path);
assert.deepEqual(classifyRunnerDeploymentPaths([]), { automatic: true, paths: [] });
assert.throws(() => validateDeployerConfig({}), /missing deployer config/);
assert.equal(validateDeployerConfig({
  BUG_RUNNER_DATABASE_URL: "postgresql://u:p@example.neon.tech/db",
  SLACK_TEAM_ID: "TQA",
  CODEX_REPOSITORY_URL: "https://github.com/Betalgeuse/otl1.git",
  CODEX_BASE_BRANCH: "main",
  BUG_DEPLOY_CHECKOUT: "/home/opc/otl1-bug-runner/current",
  BUG_DEPLOY_SERVICE: "otl1-bug-runner.service",
}).BUG_DEPLOY_SERVICE, "otl1-bug-runner.service");
console.log("PASS GenQuant deployer path policy and configuration contract");
