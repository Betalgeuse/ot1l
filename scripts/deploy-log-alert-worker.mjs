import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function prepareLogAlertConfig(value, manifest) {
  validateLogAlertConfig(value);
  const bindings = value.durable_objects?.bindings ?? [];
  if (bindings.some(b => b.name === "ALARM_INCIDENTS" && b.class_name !== "AlarmIncident"))
    throw new Error("Log alert namespace conflict");
  const migration = manifest.migrations?.find(m => m.tag === "alarm-incidents-v1");
  if (JSON.stringify(migration?.new_sqlite_classes) !== JSON.stringify(["AlarmIncident"]))
    throw new Error("Log alert migration missing");
  const migrations = value.migrations ?? [];
  if (migrations.some(m => m.tag === migration.tag && JSON.stringify(m) !== JSON.stringify(migration)))
    throw new Error("Log alert migration conflict");
  return { ...value, durable_objects: {bindings:[...bindings.filter(b=>b.name!=="ALARM_INCIDENTS"),
    {name:"ALARM_INCIDENTS",class_name:"AlarmIncident"}]},
    migrations:[...migrations.filter(m=>m.tag!==migration.tag),migration] };
}

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
  const prepared=prepareLogAlertConfig(JSON.parse(readFileSync(configPath,"utf8")),
    JSON.parse(readFileSync(join(root,"log-alerts/wrangler.jsonc"),"utf8")));
  const staged=join(root,`.wrangler.log-alerts-${randomUUID()}.json`);
  try {
    writeFileSync(staged,JSON.stringify(prepared),{flag:"wx",mode:0o600});
    execFileSync(join(root,"node_modules/.bin/wrangler"),["deploy","--config",staged,"--keep-vars"],{cwd:root,stdio:"inherit"});
  } finally {try {unlinkSync(staged);}catch(error){if(error.code!=="ENOENT")throw error;} }
}
