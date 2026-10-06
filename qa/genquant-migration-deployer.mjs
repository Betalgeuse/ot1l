import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyApprovedMigrations,
  approvedMigrationPlan,
} from "../automation/runner/migration-deployer.mjs";

const root = resolve(import.meta.dirname, "..");
const migrationPath = "migrations/084_slack_native_maintainer_work.sql";
assert.deepEqual(
  approvedMigrationPlan(root, [migrationPath], ["083-maintainer-linear-ops"]).map((item) => item.version),
  ["084-slack-native-maintainer-work"],
);
assert.deepEqual(
  approvedMigrationPlan(root, [migrationPath], [
    "083-maintainer-linear-ops",
    "084-slack-native-maintainer-work",
  ]),
  [],
);
assert.throws(() => approvedMigrationPlan(root, [migrationPath], []), /predecessor/);
assert.throws(
  () => approvedMigrationPlan(root, ["migrations/../../secret.sql"], []),
  /unsafe_migration_path/,
);

const queries = [];
const applied = new Set(["083-maintainer-linear-ops"]);
class FakeClient {
  constructor(connectionString) {
    assert.match(connectionString, /^postgresql:\/\/otl_migration_login:/);
  }
  async connect() {
    queries.push("connect");
  }
  async query(sql, params = []) {
    queries.push(sql);
    if (sql === "SET ROLE otl_migration_owner") return { rows: [] };
    if (sql === "SELECT version FROM otl.schema_migrations")
      return { rows: [...applied].map((version) => ({ version })) };
    if (sql.startsWith("SELECT version FROM otl.schema_migrations WHERE"))
      return { rows: applied.has(params[0]) ? [{ version: params[0] }] : [] };
    assert.match(sql, /084-slack-native-maintainer-work/);
    applied.add("084-slack-native-maintainer-work");
    return { rows: [] };
  }
  async end() {
    queries.push("end");
  }
}

const receipt = await applyApprovedMigrations(
  root,
  [migrationPath],
  "postgresql://otl_migration_login:secret@test.neon.tech/db?sslmode=require",
  FakeClient,
);
assert.deepEqual(receipt, [
  { file: "084_slack_native_maintainer_work.sql", version: "084-slack-native-maintainer-work" },
]);
assert.equal(queries[0], "connect");
assert.equal(queries[1], "SET ROLE otl_migration_owner");
assert.equal(queries.at(-1), "end");

const bootstrap = readFileSync(resolve(root, "scripts/bootstrap-migration-db-role.mjs"), "utf8");
assert.match(bootstrap, /otl_migration_login/);
assert.match(bootstrap, /NOINHERIT/);
assert.match(bootstrap, /SET ROLE|otl_migration_owner/);
assert.match(bootstrap, /input: `\$\{migrationUrl[.]toString\(\)\}\\n`/);
assert.doesNotMatch(bootstrap, /console[.]log\([^\n]*(password|migrationUrl)/);
console.log("PASS migration Broker applies only approved forward migrations through a dedicated role");
