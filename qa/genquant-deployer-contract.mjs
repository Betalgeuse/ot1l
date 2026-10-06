import assert from "node:assert/strict";
import {
  approvedDeploymentPaths,
  classifyRunnerDeploymentPaths,
  validateDeployerConfig,
} from "../automation/runner/genquant-deployer.mjs";
import { sha256 } from "../automation/runner/contract.mjs";

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
assert.equal(
  classifyRunnerDeploymentPaths([
    "docs/EVENTS_AND_MAINTAINERS.md",
    "src/community-townhall-events.ts",
  ]).adapter,
  "core-worker",
);
assert.equal(classifyRunnerDeploymentPaths(["site/src/index.ts"]).adapter, "site");
assert.deepEqual(
  classifyRunnerDeploymentPaths([
    "migrations/084_slack_native_maintainer_work.sql",
    "src/community-maintainer-work.ts",
    "site/src/index.ts",
  ]),
  {
    automatic: true,
    adapter: "core-stack",
    paths: [
      "migrations/084_slack_native_maintainer_work.sql",
      "site/src/index.ts",
      "src/community-maintainer-work.ts",
    ],
  },
);
assert.equal(classifyRunnerDeploymentPaths(["migrations/not-safe.sql"]).automatic, false);
assert.deepEqual(classifyRunnerDeploymentPaths([]), { automatic: false, adapter: "manual", paths: [] });
const approvedPaths = ["migrations/085_deployment_approved_paths.sql", "src/community-maintainer-work.ts"].sort();
const classificationDigest = sha256(JSON.stringify({ version: 1, changeClass: "core", paths: approvedPaths }));
assert.deepEqual(approvedDeploymentPaths({ changedPaths: approvedPaths, classificationDigest }), approvedPaths);
assert.throws(
  () => approvedDeploymentPaths({ changedPaths: approvedPaths, classificationDigest: "0".repeat(64) }),
  /digest_mismatch/,
);
assert.throws(() => approvedDeploymentPaths({}), /invalid_approved/);
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
