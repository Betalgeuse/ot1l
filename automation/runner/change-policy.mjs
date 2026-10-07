const RUNNER_PATHS = (path) =>
  path.startsWith("automation/runner/") ||
  path === "qa/genquant-runner-contract.mjs" ||
  path === "qa/genquant-deployer-contract.mjs" ||
  path.startsWith("ops/genquant/") ||
  path.startsWith("docs/") ||
  path === "scripts/test-unit.mjs" ||
  path === "scripts/export-public-manifest.mjs";

const OPEN_EVENT_PATHS = new Set([
  "site/dist/event-schedule.html",
  "site/dist/event-schedule.js",
  "site/dist/styles.css",
  "site/qa/event-schedule.mjs",
]);

const CORE_WORKER_PATH = (path) =>
  path.startsWith("src/") ||
  path.startsWith("qa/") ||
  path === "package.json" ||
  path === "bun.lock" ||
  path === "tsconfig.json" ||
  path === "worker-configuration.d.ts" ||
  path === "wrangler.jsonc" ||
  path === ".dev.vars.example" ||
  path === "slack-manifest.json" ||
  path.startsWith("scripts/");

const CORE_STACK_PATH = (path) =>
  path.startsWith("migrations/") || path.startsWith("site/") || CORE_WORKER_PATH(path);

function openEventPath(path) {
  return path.startsWith("event-site/") || OPEN_EVENT_PATHS.has(path);
}

export function classifyChangePaths(paths) {
  const ordered = [...new Set(paths)].sort();
  if (ordered.length === 0) return { changeClass: "core", adapter: "manual", paths: ordered };
  if (ordered.every(openEventPath))
    return { changeClass: "open", adapter: "open-events", paths: ordered };
  if (ordered.every(RUNNER_PATHS))
    return { changeClass: "core", adapter: "runner", paths: ordered };
  if (ordered.every(CORE_WORKER_PATH))
    return { changeClass: "core", adapter: "core-worker", paths: ordered };
  if (
    ordered.every(CORE_STACK_PATH) &&
    ordered.some((path) => path.startsWith("migrations/")) &&
    ordered.some((path) => path.startsWith("site/")) &&
    ordered.some(CORE_WORKER_PATH)
  )
    return { changeClass: "core", adapter: "core-stack", paths: ordered };
  return { changeClass: "core", adapter: "manual", paths: ordered };
}
