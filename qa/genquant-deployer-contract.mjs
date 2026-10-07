import assert from "node:assert/strict";
import {
  approvedPathDigest,
  classifyRunnerDeploymentPaths,
  runCoreStack,
  validateDeployerConfig,
  verifyApprovedPaths,
} from "../automation/runner/genquant-deployer.mjs";
import { deployMigrations } from "../automation/runner/migration-deployer.mjs";

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
    "migrations/081_core.sql",
    "src/index.ts",
    "site/src/index.ts",
  ]).adapter,
  "core-stack",
);
const paths = ["migrations/081_core.sql", "site/src/index.ts", "src/index.ts"];
const digest = approvedPathDigest("core", paths);
assert.equal(
  verifyApprovedPaths(
    { changedPaths: paths, changeClass: "core", classificationDigest: digest },
    paths,
  ).adapter,
  "core-stack",
);
assert.throws(
  () =>
    verifyApprovedPaths(
      { changedPaths: paths.slice(1), changeClass: "core", classificationDigest: digest },
      paths,
    ),
  /approved_paths_mismatch/,
);
const order = [];
runCoreStack({ migrations: () => order.push("migration"), core: () => order.push("core"), site: () => order.push("site") });
assert.deepEqual(order, ["migration", "core", "site"]);
const calls = [];
assert.deepEqual(
  deployMigrations(
    "/tmp/checkout",
    ["src/index.ts", "migrations/082_second.sql", "migrations/081_first.sql"],
    { OTL1_PRODUCTION_DATABASE_URL: "postgresql://example.invalid/db" },
    (...args) => calls.push(args),
  ),
  ["migrations/081_first.sql", "migrations/082_second.sql"],
);
assert.deepEqual(calls.map((call) => call[1].at(-1)), ["migrations/081_first.sql", "migrations/082_second.sql"]);
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
