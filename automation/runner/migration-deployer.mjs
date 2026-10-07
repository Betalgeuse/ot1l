import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const MIGRATION = /^migrations\/[0-9]{3}_[a-z0-9_]+[.]sql$/;

export function migrationPaths(paths) {
  return [...new Set(paths.filter((path) => path.startsWith("migrations/")))].sort();
}

export function deployMigrations(checkout, paths, config, execute = execFileSync) {
  const migrations = migrationPaths(paths);
  if (migrations.some((path) => !MIGRATION.test(path)))
    throw new Error("invalid_migration_path");
  if (migrations.length === 0) return [];
  if (typeof config.OTL1_PRODUCTION_DATABASE_URL !== "string" || !config.OTL1_PRODUCTION_DATABASE_URL.trim())
    throw new Error("migration_deployer_unconfigured");
  const cwd = resolve(checkout);
  for (const migration of migrations)
    execute("psql", [config.OTL1_PRODUCTION_DATABASE_URL, "-X", "-v", "ON_ERROR_STOP=1", "-f", migration], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10 * 60_000,
      maxBuffer: 4 * 1024 * 1024,
    });
  return migrations;
}
