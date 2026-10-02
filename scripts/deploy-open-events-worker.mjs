import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function validateOpenEventsConfig(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError("Open events Wrangler config must be an object");
  if (value.name !== "otl1-open-events") throw new TypeError("Open events Worker name mismatch");
  const serialized = JSON.stringify(value);
  if (/REPLACE|replace-with|your-site[.]workers[.]dev/.test(serialized))
    throw new TypeError("Open events config contains placeholders");
  if (value.main !== "event-site/src/index.ts") throw new TypeError("Open events entrypoint mismatch");
  if (value.assets?.directory !== "site/dist") throw new TypeError("Open events assets mismatch");
  const core = Array.isArray(value.services) ? value.services.find((item) => item?.binding === "CORE") : undefined;
  if (!core?.service) throw new TypeError("Open events CORE service binding missing");
  return value;
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  const configured = process.env.OTL1_OPEN_EVENTS_WRANGLER_CONFIG ?? ".wrangler.open-events.json";
  const configPath = isAbsolute(configured) ? configured : resolve(root, configured);
  if (dirname(configPath) !== root)
    throw new TypeError("Open events config must be stored in the repository root");
  validateOpenEventsConfig(JSON.parse(readFileSync(configPath, "utf8")));
  execFileSync(join(root, "node_modules/.bin/wrangler"), ["deploy", "--config", configPath, "--keep-vars"], { cwd: root, stdio: "inherit" });
}
