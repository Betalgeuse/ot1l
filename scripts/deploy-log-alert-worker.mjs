import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function validateLogAlertConfig(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError("Log alert Wrangler config must be an object");
  if (value.name !== "otl1-log-alerts") throw new TypeError("Log alert Worker name mismatch");
  if (value.main !== "src/log-alert-worker.ts")
    throw new TypeError("Log alert Worker entrypoint mismatch");
  if (!/^C[A-Z0-9]+$/.test(value.vars?.COMMUNITY_SYS_ALERT_CHANNEL_ID ?? ""))
    throw new TypeError("Log alert Slack channel missing");
  if (/REPLACE|example/.test(JSON.stringify(value)))
    throw new TypeError("Log alert config contains placeholders");
  const limiter = Array.isArray(value.ratelimits)
    ? value.ratelimits.find((item) => item?.name === "ALERT_RATE_LIMITER")
    : undefined;
  if (!limiter || limiter.simple?.limit !== 1 || limiter.simple?.period !== 60)
    throw new TypeError("Log alert rate limit mismatch");
  return value;
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  const configured = process.env.OTL1_LOG_ALERT_WRANGLER_CONFIG ?? ".wrangler.log-alerts.json";
  const configPath = isAbsolute(configured) ? configured : resolve(root, configured);
  if (dirname(configPath) !== root)
    throw new TypeError("Log alert config must be stored in the repository root");
  validateLogAlertConfig(JSON.parse(readFileSync(configPath, "utf8")));
  execFileSync(join(root, "node_modules/.bin/wrangler"), [
    "deploy",
    "--config",
    configPath,
    "--keep-vars",
  ], { cwd: root, stdio: "inherit" });
}
