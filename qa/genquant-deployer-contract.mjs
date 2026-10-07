import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classificationDigest,
  classifyRunnerDeploymentPaths,
  validateDeployerConfig,
  verifyApprovedPaths,
} from "../automation/runner/genquant-deployer.mjs";
import {
  applyForwardMigrations,
  migrationConnection,
} from "../automation/runner/migration-deployer.mjs";

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
assert.equal(classifyRunnerDeploymentPaths(["migrations/082_forward.sql"]).adapter, "production");
assert.equal(classifyRunnerDeploymentPaths(["site/src/index.ts"]).adapter, "manual");
assert.equal(classifyRunnerDeploymentPaths([
  "migrations/082_forward.sql", "src/index.ts", "site/src/index.ts",
]).adapter, "production");
assert.deepEqual(classifyRunnerDeploymentPaths([]), { automatic: false, adapter: "manual", paths: [] });
assert.throws(() => validateDeployerConfig({}), /missing deployer config/);
assert.equal(validateDeployerConfig({
  BUG_RUNNER_DATABASE_URL: "postgresql://u:p@example.neon.tech/db",
  SLACK_TEAM_ID: "TQA",
  CODEX_REPOSITORY_URL: "https://github.com/Betalgeuse/ot1l.git",
  CODEX_BASE_BRANCH: "main",
  BUG_DEPLOY_CHECKOUT: "/home/opc/otl1-bug-runner/current",
  BUG_DEPLOY_SERVICE: "otl1-bug-runner.service",
  OTL1_MIGRATION_DATABASE_URL: "postgresql://otl_migration_login:secret@test.neon.tech/db",
  BUG_DEPLOY_SITE_HEALTH_URL: "https://site.example/health",
  BUG_DEPLOY_APPROVAL_SCOPE_MIGRATION: "085",
}).BUG_DEPLOY_SERVICE, "otl1-bug-runner.service");
assert.throws(() => migrationConnection("postgresql://postgres:secret@test.neon.tech/db"),
  /invalid migration database URL/);

const policy = classifyRunnerDeploymentPaths(["migrations/082_forward.sql", "src/index.ts"]);
const digest = classificationDigest(policy);
verifyApprovedPaths({ changedPaths: policy.paths, classificationDigest: digest }, policy);
assert.throws(() => verifyApprovedPaths({ changedPaths: ["src/index.ts"], classificationDigest: digest }, policy),
  /approved_paths_mismatch/);
const bootstrapPolicy = classifyRunnerDeploymentPaths([
  "automation/runner/genquant-deployer.mjs",
  "migrations/085_deployment_approval_scope.sql",
]);
verifyApprovedPaths({}, bootstrapPolicy, "085");
assert.throws(() => verifyApprovedPaths({}, policy, "085"), /approved_paths_mismatch/);

const checkout = mkdtempSync(join(tmpdir(), "otl1-migration-"));
mkdirSync(join(checkout, "migrations"));
writeFileSync(join(checkout, "migrations/082_forward.sql"),
  "BEGIN; SELECT 1; INSERT INTO otl.schema_migrations(version) VALUES('082-forward'); COMMIT;\n");
const calls = [];
let applied = false;
const versions = applyForwardMigrations(checkout, ["migrations/082_forward.sql"],
  "postgresql://otl_migration_login:do-not-log@test.neon.tech/db", (connection, sql) => {
    calls.push({ connection, sql });
    if (sql.includes("INSERT INTO")) applied = true;
    return applied ? "082-forward" : "";
  });
assert.deepEqual(versions, ["082-forward"]);
assert.equal(calls.length, 3);
assert.ok(calls.every(({ sql }) => sql.startsWith("SET ROLE otl_migration_owner;")));
assert.ok(calls.every(({ sql }) => !sql.includes("do-not-log")));
assert.equal(calls[0].connection.PGUSER, "otl_migration_login");
assert.equal(calls[0].connection.PGPASSWORD, "do-not-log");
assert.throws(() => applyForwardMigrations(checkout, ["migrations/down.sql"],
  "postgresql://otl_migration_login:secret@test.neon.tech/db", () => ""), /invalid migration path/);

writeFileSync(join(checkout, "migrations/083_first.sql"),
  "BEGIN; INSERT INTO otl.schema_migrations(version) VALUES('083-first'); COMMIT;\n");
writeFileSync(join(checkout, "migrations/084_second.sql"),
  "BEGIN; INSERT INTO otl.schema_migrations(version) VALUES('084-second'); COMMIT;\n");
let appliedVersions = new Set(["082-forward"]);
let failSecond = true;
const retryExecute = (_connection, sql) => {
  if (sql.includes("SELECT version")) return [...appliedVersions].sort().join("\n");
  if (sql.includes("084-second") && failSecond) throw new Error("interrupted");
  const version = sql.match(/VALUES\('([^']+)'\)/)?.[1];
  if (version) appliedVersions.add(version);
  return "";
};
assert.throws(() => applyForwardMigrations(checkout,
  ["migrations/083_first.sql", "migrations/084_second.sql"],
  "postgresql://otl_migration_login:secret@test.neon.tech/db", retryExecute), /interrupted/);
failSecond = false;
assert.deepEqual(applyForwardMigrations(checkout,
  ["migrations/083_first.sql", "migrations/084_second.sql"],
  "postgresql://otl_migration_login:secret@test.neon.tech/db", retryExecute), ["084-second"]);

appliedVersions = new Set(["082-forward"]);
assert.throws(() => applyForwardMigrations(checkout, ["migrations/084_second.sql"],
  "postgresql://otl_migration_login:secret@test.neon.tech/db", retryExecute),
  /migration predecessor missing/);

console.log("PASS GenQuant deployer approval, migration, path policy and configuration contract");
