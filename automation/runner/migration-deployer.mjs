import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const MIGRATION_PATH = /^migrations\/(\d{3})_[a-z0-9_]+[.]sql$/;
const VERSION_INSERT = /INSERT INTO otl[.]schema_migrations\(version\) VALUES\('([^']+)'\);/g;

function migrationDescriptor(root, relativePath) {
  const match = MIGRATION_PATH.exec(relativePath);
  if (!match) throw new Error("unsafe_migration_path");
  const absolutePath = resolve(root, relativePath);
  if (!absolutePath.startsWith(`${resolve(root, "migrations")}/`))
    throw new Error("unsafe_migration_path");
  const stat = lstatSync(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 1024 * 1024)
    throw new Error("unsafe_migration_file");
  const sql = readFileSync(absolutePath, "utf8");
  const versions = [...sql.matchAll(VERSION_INSERT)].map((item) => item[1]);
  if (
    versions.length !== 1 ||
    !sql.trimStart().startsWith("BEGIN;") ||
    !sql.trimEnd().endsWith("COMMIT;")
  )
    throw new Error("invalid_migration_contract");
  return { number: Number(match[1]), relativePath, sql, version: versions[0] };
}

export function approvedMigrationPlan(root, changedPaths, appliedVersions) {
  const migrations = changedPaths
    .filter((path) => path.startsWith("migrations/"))
    .map((path) => migrationDescriptor(root, path))
    .sort((left, right) => left.number - right.number);
  const all = readdirSync(resolve(root, "migrations"))
    .filter((name) => /^\d{3}_[a-z0-9_]+[.]sql$/.test(name))
    .map((name) => ({ number: Number(name.slice(0, 3)), relativePath: join("migrations", name) }))
    .sort((left, right) => left.number - right.number);
  const applied = new Set(appliedVersions);
  const pending = [];
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    const predecessorEntry = all.filter((candidate) => candidate.number < migration.number).at(-1);
    const predecessor = predecessorEntry
      ? migrationDescriptor(root, predecessorEntry.relativePath)
      : null;
    if (predecessor && !applied.has(predecessor.version) && !pending.some((item) => item.version === predecessor.version))
      throw new Error("migration_predecessor_missing");
    pending.push(migration);
  }
  return pending;
}

function validateMigrationUrl(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("migration_deployer_unconfigured");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname.endsWith(".neon.tech") ||
    url.username !== "otl_migration_login" ||
    !url.password ||
    url.pathname.length < 2
  )
    throw new Error("invalid_migration_database_url");
  return connectionString;
}

export async function applyApprovedMigrations(root, changedPaths, connectionString, ClientClass) {
  const DatabaseClient =
    ClientClass ?? (await import("@neondatabase/serverless")).Client;
  const client = new DatabaseClient(validateMigrationUrl(connectionString));
  const appliedNow = [];
  try {
    await client.connect();
    await client.query("SET ROLE otl_migration_owner");
    const current = await client.query("SELECT version FROM otl.schema_migrations");
    const applied = current.rows.map((row) => String(row.version));
    const plan = approvedMigrationPlan(root, changedPaths, applied);
    for (const migration of plan) {
      try {
        await client.query(migration.sql);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
      const readback = await client.query(
        "SELECT version FROM otl.schema_migrations WHERE version=$1",
        [migration.version],
      );
      if (readback.rows.length !== 1) throw new Error("migration_readback_failed");
      appliedNow.push({ file: basename(migration.relativePath), version: migration.version });
    }
    return appliedNow;
  } finally {
    await client.end().catch(() => undefined);
  }
}
