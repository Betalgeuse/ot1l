import { readFileSync } from "node:fs";

const RUNNER_PATHS = (path) =>
  path.startsWith("automation/runner/") ||
  path === "qa/genquant-runner-contract.mjs" ||
  path === "qa/genquant-deployer-contract.mjs" ||
  path.startsWith("ops/genquant/") ||
  path.startsWith("docs/") ||
  path === "scripts/test-unit.mjs" ||
  path === "scripts/export-public-manifest.mjs";

const GUIDE_PATHS = new Set(["AGENTS.md", "CONTRIBUTING.md", "README.md", ".github/PULL_REQUEST_TEMPLATE.md"]);

const OPEN_EVENT_PATHS = new Set([
  "site/dist/event-schedule.html",
  "site/dist/event-schedule.js",
  "site/dist/styles.css",
  "site/qa/event-schedule.mjs",
]);

const OPEN_PRESENTATION_PATH = /^src\/slack-presentation\/[a-z0-9-]+[.]ts$/;
const FORBIDDEN_PRESENTATION_SOURCE = [
  [/(?:^|\n)\s*(?:import|export\s+[^\n]*\s+from)\b|\brequire\s*\(/i, "dependency"],
  [/\b(?:process[.]env|env|fetch|secret|token|password|credential)\b/i, "environment or secret"],
  [/\b(?:database|postgres|neon|sql|query|api|route|router|request|response|webhook)\b/i, "data or API"],
  [/\b(?:actor|member|role|email|phone|address|user(?:name|id)?|person|pii)\b/i, "identity or PII"],
  [/\b(?:broker|deploy|merge|github|slack-api)\b/i, "Broker or deployment"],
];

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
  if (path.startsWith("event-site/") && /(?:^|\/)(?:wrangler[.][^/]+|package(?:-lock)?[.]json|bun[.]lockb?|[.]env[^/]*|[.]npmrc)$/.test(path)) return false;
  return path.startsWith("event-site/") || OPEN_EVENT_PATHS.has(path);
}

function openPresentationPath(path) {
  return OPEN_PRESENTATION_PATH.test(path);
}

export function assertOpenPresentationBoundary(paths, readSource = readFileSync) {
  for (const path of paths.filter(openPresentationPath)) {
    const source = readSource(path, "utf8");
    for (const [pattern, boundary] of FORBIDDEN_PRESENTATION_SOURCE) {
      if (pattern.test(source))
        throw new Error(`open presentation file crosses the ${boundary} boundary: ${path}`);
    }
  }
}

export function classifyChangePaths(paths) {
  const ordered = [...new Set(paths)].sort();
  if (ordered.length === 0) return { changeClass: "core", adapter: "manual", paths: ordered };
  if (ordered.every(openEventPath))
    return { changeClass: "open", adapter: "open-events", paths: ordered };
  if (ordered.every(openPresentationPath))
    return { changeClass: "open", adapter: "core-worker", paths: ordered };
  if (ordered.every(RUNNER_PATHS))
    return { changeClass: "core", adapter: "runner", paths: ordered };
  if (ordered.every(CORE_WORKER_PATH))
    return { changeClass: "core", adapter: "core-worker", paths: ordered };
  if (ordered.some((path) => path.startsWith("migrations/")) && ordered.every(PRODUCTION_PATH))
    return { changeClass: "core", adapter: "production", paths: ordered };
  if (ordered.every(path => PRODUCTION_PATH(path) || RUNNER_PATHS(path) || GUIDE_PATHS.has(path) || openEventPath(path)))
    return { changeClass: "core", adapter: "production", paths: ordered };
  return { changeClass: "core", adapter: "manual", paths: ordered };
}

export function includesMigration(paths, version) {
  return paths.some((path) => MIGRATION_PATH.exec(path)?.[1] === version);
}
