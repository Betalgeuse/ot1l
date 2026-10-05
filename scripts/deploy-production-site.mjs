import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const site = resolve(root, "site");
const configPath = resolve(site, ".wrangler.production.json");
if (process.argv.slice(2).join(" ") !== "--apply")
  throw new Error("Use --apply to deploy the production site");
const config = JSON.parse(readFileSync(configPath, "utf8"));
if (dirname(configPath) !== site || config.name !== "otl1-site" || config.main !== "src/index.ts")
  throw new TypeError("Production site target mismatch");
if (config.services?.length !== 1 || config.services[0]?.binding !== "CORE" ||
    config.services[0]?.service !== "otl1-onething-garden")
  throw new TypeError("Production site Core binding mismatch");
if (config.assets?.directory !== "./dist" || config.vars?.PUBLIC_APPLICATIONS_ENABLED !== "true" ||
    /REPLACE|example[.]com/.test(JSON.stringify(config)))
  throw new TypeError("Production site configuration mismatch");
execFileSync(resolve(root, "node_modules/.bin/wrangler"), [
  "deploy", "--config", configPath, "--keep-vars",
], { cwd: site, stdio: "inherit" });
