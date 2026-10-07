import { existsSync, lstatSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

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

const MIGRATION_PATH = /^migrations\/([0-9]{3})_[a-z0-9_]+[.]sql$/;

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

const PRODUCTION_PATH = (path) =>
  path.startsWith("migrations/") ||
  CORE_WORKER_PATH(path) ||
  (path.startsWith("site/") && !openEventPath(path));

function openEventPath(path) {
  return path.startsWith("event-site/") || OPEN_EVENT_PATHS.has(path);
}

function slackPresentationPath(path) {
  return /^src\/slack-presentation\/[a-z0-9-]+[.]ts$/.test(path);
}

const FORBIDDEN_PRESENTATION_SOURCE = [
  [/(?:^|\n)\s*(?:import\s|export\s+(?:[*{]|[^\n;]+\sfrom\s))/m, "imports"],
  [/\b(?:process[.]env|import[.]meta[.]env|env\s*[.[])\b/, "environment access"],
  [/\bfetch\s*[(]/, "network access"],
  [/\b(?:database|db|sql|postgres|neon)\b/i, "database access"],
  [/\b(?:slackApi|githubApi|WebClient)\b/, "API access"],
  [/\b(?:route|router|routing)\b/i, "routing access"],
];

// This validator lives in the Core-owned runner boundary, not in the Open directory it
// protects. Presentation modules are deliberately dependency-free data builders.
export function verifySlackPresentationBoundary(checkout, paths) {
  const root = resolve(checkout);
  for (const path of paths.filter(slackPresentationPath)) {
    const file = resolve(root, path);
    if (relative(root, file).startsWith(`..${sep}`))
      throw new Error("invalid_slack_presentation_path");
    if (!existsSync(file)) continue;
    if (lstatSync(file).isSymbolicLink()) throw new Error("invalid_slack_presentation_path");
    const source = readFileSync(file, "utf8");
    const violation = FORBIDDEN_PRESENTATION_SOURCE.find(([pattern]) => pattern.test(source));
    if (violation) throw new Error(`slack_presentation_boundary:${violation[1]}`);
  }
}

export function classifyChangePaths(paths) {
  const ordered = [...new Set(paths)].sort();
  if (ordered.length === 0) return { changeClass: "core", adapter: "manual", paths: ordered };
  if (ordered.every(openEventPath))
    return { changeClass: "open", adapter: "open-events", paths: ordered };
  if (ordered.every(slackPresentationPath))
    return { changeClass: "open", adapter: "core-worker", paths: ordered };
  if (ordered.every(RUNNER_PATHS))
    return { changeClass: "core", adapter: "runner", paths: ordered };
  if (ordered.every(CORE_WORKER_PATH))
    return { changeClass: "core", adapter: "core-worker", paths: ordered };
  if (ordered.some((path) => path.startsWith("migrations/")) && ordered.every(PRODUCTION_PATH))
    return { changeClass: "core", adapter: "production", paths: ordered };
  return { changeClass: "core", adapter: "manual", paths: ordered };
}

export function includesMigration(paths, version) {
  return paths.some((path) => MIGRATION_PATH.exec(path)?.[1] === version);
}
