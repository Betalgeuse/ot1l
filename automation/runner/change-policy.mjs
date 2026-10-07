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
  "site/dist/event-schedule.css",
  "site/qa/event-schedule.mjs",
]);

const DOCUMENTATION_PATH = (path) =>
  path.startsWith("docs/") || path === "CONTRIBUTING.md" || path === "README.md";

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

function openEventPath(path) {
  return path.startsWith("event-site/") || OPEN_EVENT_PATHS.has(path);
}

function sitePath(path) {
  return path.startsWith("site/");
}

function migrationPath(path) {
  return /^migrations\/\d{3}_[a-z0-9_]+[.]sql$/.test(path);
}

function coreStackPath(path) {
  return (
    CORE_WORKER_PATH(path) ||
    RUNNER_PATHS(path) ||
    migrationPath(path) ||
    path.startsWith("site/")
  );
}

export function classifyChangePaths(paths) {
  const ordered = [...new Set(paths)].sort();
  const operational = ordered.filter((path) => !DOCUMENTATION_PATH(path));
  if (ordered.length === 0) return { changeClass: "core", adapter: "manual", paths: ordered };
  if (operational.length === 0)
    return { changeClass: "core", adapter: "runner", paths: ordered };
  if (operational.every(openEventPath))
    return { changeClass: "open", adapter: "open-events", paths: ordered };
  if (operational.every(sitePath))
    return { changeClass: "core", adapter: "site", paths: ordered };
  if (operational.every(RUNNER_PATHS))
    return { changeClass: "core", adapter: "runner", paths: ordered };
  if (operational.every(CORE_WORKER_PATH))
    return { changeClass: "core", adapter: "core-worker", paths: ordered };
  if (
    operational.every(coreStackPath) &&
    operational.some((path) => migrationPath(path) || sitePath(path))
  )
    return { changeClass: "core", adapter: "core-stack", paths: ordered };
  return { changeClass: "core", adapter: "manual", paths: ordered };
}
