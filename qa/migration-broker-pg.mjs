import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const pgBin = process.env.PG_BIN ?? "/opt/homebrew/opt/postgresql@17/bin";
const temp = await mkdtemp(join(tmpdir(), "otl-migration-broker-"));
const data = join(temp, "data"), socket = join(temp, "socket"), secretFile = join(temp, "secret");
const port = String(64500 + Math.floor(Math.random() * 500));
const database = "migration_broker";
const baseEnv = { ...process.env, PGHOST: socket, PGPORT: port, PGDATABASE: database };
let started = false;
const run = (bin, args, options = {}) =>
  exec(bin, args, { cwd: root, env: { ...baseEnv, ...options.env }, encoding: "utf8", input: options.input });
try {
  await run("mkdir", ["-p", socket]);
  await run(join(pgBin, "initdb"), ["-D", data, "--no-locale", "--encoding=UTF8", "--auth=trust"]);
  await run(join(pgBin, "pg_ctl"), ["-D", data, "-o", `-F -k ${socket} -p ${port}`, "-l", join(temp, "postgres.log"), "-w", "start"]);
  started = true;
  await run(join(pgBin, "createdb"), [database]);
  const files = (await readdir(join(root, "migrations")))
    .filter((name) => /^\d{3}_.*[.]sql$/.test(name) && Number(name.slice(0, 3)) <= 83)
    .sort();
  for (const file of files.filter((name) => Number(name.slice(0, 3)) <= 5))
    await run(join(pgBin, "psql"), ["-X", "-v", "ON_ERROR_STOP=1", "-f", `migrations/${file}`]);
  await run(join(pgBin, "psql"), ["-X", "-v", "ON_ERROR_STOP=1", "--single-transaction",
    "-f", "migrations/006_normalized_foundation.sql", "-f", "migrations/007_normalized_legacy.sql"]);
  for (const file of files.filter((name) => Number(name.slice(0, 3)) >= 8))
    await run(join(pgBin, "psql"), ["-X", "-v", "ON_ERROR_STOP=1", "-f", `migrations/${file}`]);

  const owner = process.env.USER ?? "postgres";
  const ownerUrl = `postgresql://${owner}:owner@127.0.0.1:${port}/${database}?sslmode=disable&channel_binding=disable`;
  await run("node", ["scripts/bootstrap-migration-db-role.mjs"], {
    env: {
      DATABASE_URL: ownerUrl,
      PSQL_BIN: join(pgBin, "psql"),
      MIGRATION_SECRET_SINK: "/usr/bin/tee",
      MIGRATION_SECRET_SINK_ARGS: JSON.stringify([secretFile]),
      MIGRATION_BOOTSTRAP_DIAGNOSTICS: "true",
    },
  });
  const migrationUrl = (await readFile(secretFile, "utf8")).trim();
  assert.equal(new URL(migrationUrl).username, "otl_migration_login");
  await assert.rejects(
    exec(join(pgBin, "psql"), [migrationUrl, "-XAtq", "-v", "ON_ERROR_STOP=1", "-c", "SELECT count(*) FROM otl.schema_migrations"], { encoding: "utf8" }),
  );
  const migration = [
    await readFile(join(root, "migrations/084_slack_native_maintainer_work.sql"), "utf8"),
    await readFile(join(root, "migrations/085_deployment_approved_paths.sql"), "utf8"),
    await readFile(join(root, "migrations/086_durable_member_onboarding.sql"), "utf8"),
  ].join("\n");
  const applied = spawnSync(join(pgBin, "psql"), [migrationUrl, "-Xq", "-v", "ON_ERROR_STOP=1"], {
    encoding: "utf8",
    input: `SET ROLE otl_migration_owner;\n${migration}`,
  });
  if (applied.status !== 0) throw new Error("migration role could not apply 084");
  const verified = await run(join(pgBin, "psql"), ["-XAtq", "-v", "ON_ERROR_STOP=1", "-c",
    "SELECT version FROM otl.schema_migrations WHERE version IN ('084-slack-native-maintainer-work','085-deployment-approved-paths','086-durable-member-onboarding') ORDER BY version"]);
  assert.deepEqual(verified.stdout.trim().split("\n"), [
    "084-slack-native-maintainer-work",
    "085-deployment-approved-paths",
    "086-durable-member-onboarding",
  ]);
  console.log("PASS migration Broker role is NOINHERIT by default and applies approved migrations only after SET ROLE");
} finally {
  if (started) await run(join(pgBin, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]).catch(() => {});
  await rm(temp, { recursive: true, force: true });
}
