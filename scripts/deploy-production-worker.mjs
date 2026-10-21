import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

export const PRODUCTION_CRONS = [
  "*/5 * * * *",
  "1-59/5 * * * *",
];

export function validateProductionConfig(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError("Production Wrangler config must be an object");
  if (value.name !== "otl1-onething-garden")
    throw new TypeError("Production Worker name mismatch");
  const serialized = JSON.stringify(value);
  if (/REPLACE|example[.]slack[.]com|your-site[.]workers[.]dev/.test(serialized))
    throw new TypeError("Production Wrangler config contains placeholders");
  const buckets = new Map(
    (Array.isArray(value.r2_buckets) ? value.r2_buckets : []).map((item) => [
      item?.binding,
      item?.bucket_name,
    ]),
  );
  if (
    buckets.get("BUG_PRIVATE_OBJECTS") !== "otl1-bug-private" ||
    buckets.get("INVITE_PRIVATE_OBJECTS") !== "otl1-invite-private"
  )
    throw new TypeError("Production R2 binding mismatch");
  const crons = value.triggers?.crons;
  if (
    !Array.isArray(crons) ||
    JSON.stringify(crons) !== JSON.stringify(PRODUCTION_CRONS)
  )
    throw new TypeError("Production cron triggers must match the two-trigger manifest exactly");
  return value;
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  const configured = process.env.OTL1_PRODUCTION_WRANGLER_CONFIG ?? ".wrangler.production.json";
  const configPath = isAbsolute(configured) ? configured : resolve(root, configured);
  if (dirname(configPath) !== root)
    throw new TypeError("Production config must be stored in the repository root");
  validateProductionConfig(JSON.parse(readFileSync(configPath, "utf8")));
  execFileSync(join(root, "node_modules/.bin/wrangler"), [
    "deploy",
    "--config",
    configPath,
    "--keep-vars",
    // Private production configs may predate the isolated maintenance lane.
    // Apply the reviewed schedule manifest without copying or rewriting vars.
    "--triggers",
    ...PRODUCTION_CRONS,
  ], { cwd: root, stdio: "inherit" });
}
