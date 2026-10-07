import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

const MIGRATION = /^migrations\/[0-9]{3}_[a-z0-9_]+[.]sql$/;

export function migrationConnection(urlString) {
  const url = new URL(urlString);
  if (url.protocol !== "postgresql:" || url.username !== "otl_migration_login" || !url.password ||
      !url.hostname.endsWith(".neon.tech") || !url.pathname.slice(1))
    throw new Error("invalid migration database URL");
  return {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: "require",
  };
}

function psql(connection, input) {
  return execFileSync("psql", ["-X", "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-At"], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    input,
    env: { ...process.env, ...connection },
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  }).trim();
}

function versionOf(sql, path) {
  const match = sql.match(/INSERT\s+INTO\s+otl[.]schema_migrations\s*\(version\)\s*VALUES\s*\('([^']+)'\)/i);
  if (!match) throw new Error(`migration version missing: ${basename(path)}`);
  return match[1];
}

export function applyForwardMigrations(checkout, paths, databaseUrl, execute = psql) {
  const migrationPaths = paths.filter((path) => path.startsWith("migrations/"));
  if (migrationPaths.some((path) => !MIGRATION.test(path))) throw new Error("invalid migration path");
  if (migrationPaths.length === 0) return [];
  const connection = migrationConnection(databaseUrl);
  const applied = new Set(execute(connection,
    "SET ROLE otl_migration_owner; SELECT version FROM otl.schema_migrations ORDER BY version;\n")
    .split("\n").filter(Boolean));
  const migrations = migrationPaths.sort().map((path) => {
    const sql = readFileSync(join(checkout, path), "utf8");
    return { path, sql, version: versionOf(sql, path) };
  });
  const pending = migrations.filter(({ version }) => !applied.has(version));
  if (pending.length !== migrations.length) throw new Error("migration already applied");
  for (const migration of pending)
    execute(connection, `SET ROLE otl_migration_owner;\n${migration.sql}\n`);
  const verified = new Set(execute(connection,
    "SET ROLE otl_migration_owner; SELECT version FROM otl.schema_migrations ORDER BY version;\n")
    .split("\n").filter(Boolean));
  if (pending.some(({ version }) => !verified.has(version))) throw new Error("migration readback failed");
  return pending.map(({ version }) => version);
}
