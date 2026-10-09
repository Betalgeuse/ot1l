import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const RUNNER_PATHS = (path) =>
  path.startsWith("automation/runner/") ||
  path === "qa/genquant-runner-contract.mjs" ||
  path === "qa/genquant-deployer-contract.mjs" ||
  path.startsWith("ops/genquant/") ||
  path === "scripts/test-unit.mjs" ||
  path === "scripts/export-public-manifest.mjs";

const GUIDE_PATHS = new Set(["AGENTS.md", "CONTRIBUTING.md", "README.md", ".github/PULL_REQUEST_TEMPLATE.md"]);

// Product approval and deployment destination are independent. These paths
// do not grant access to the host, production credentials, or stored member data.
const OPEN_DOCUMENT = (path) =>
  /^(?:docs\/|site\/|event-site\/|design-preview\/)[A-Za-z0-9_./-]+[.]md$/.test(path) ||
  ["README.md", "CONTRIBUTING.md", ".github/PULL_REQUEST_TEMPLATE.md"].includes(path);
const OPEN_ASSET = (path) =>
  /^site\/dist\/assets\/[A-Za-z0-9_./-]+[.](?:png|jpe?g|gif|webp|avif|ico|woff2?)$/.test(path);
const OPEN_PREVIEW = (path) =>
  /^design-preview\/[A-Za-z0-9_./-]+[.](?:html|css|js|png|jpe?g|gif|webp|svg)$/.test(path);
const OPEN_QA = (path) => /^(?:qa|site\/qa)\/[a-z0-9_-]+[.](?:mjs|sql|json)$/.test(path) &&
  !RUNNER_PATHS(path);

const OPEN_EVENT_PATHS = new Set([
  "site/dist/event-schedule.html",
  "site/dist/event-schedule.js",
  "site/dist/styles.css",
  "site/qa/event-schedule.mjs",
]);

const OPEN_PRESENTATION_PATH = /^src\/slack-presentation\/[a-z0-9-]+[.]ts$/;

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

function assertLiteralExports(source) {
  // Deliberately tiny grammar, not a JavaScript evaluator or keyword filter.
  // export const NAME = JSON-like-literal [as const]; (double-quoted strings).
  const lexer = /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\\r\n]|\\.)*"|-?(?:0|[1-9][0-9]*)(?:[.][0-9]+)?(?:[eE][+-]?[0-9]+)?|[A-Za-z_$][A-Za-z0-9_$]*|[{}\[\]:,;=]/y;
  const tokens = [];
  let offset = 0;
  while (offset < source.length) {
    lexer.lastIndex = offset;
    const match = lexer.exec(source);
    if (!match) throw new Error("invalid literal token");
    offset = lexer.lastIndex;
    if (!/^\s|^\/\//.test(match[0]) && !match[0].startsWith("/*")) tokens.push(match[0]);
  }
  let index = 0;
  const take = expected => { if (tokens[index++] !== expected) throw new Error("invalid literal syntax"); };
  const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
  function value(depth = 0) {
    if (depth > 32) throw new Error("literal nesting limit");
    const token = tokens[index++];
    if (token === "{" || token === "[") {
      const close = token === "{" ? "}" : "]";
      while (tokens[index] !== close) {
        if (token === "{") {
          const key = tokens[index++];
          if (!key || (!identifier.test(key) && !key.startsWith('"'))) throw new Error("invalid literal key");
          if ((key.startsWith('"') ? JSON.parse(key) : key) === "__proto__") throw new Error("prototype key");
          take(":");
        }
        value(depth + 1);
        if (tokens[index] !== close) take(",");
      }
      take(close);
    } else {
      if (!token || !/^(?:"|-?[0-9]|true$|false$|null$)/.test(token)) throw new Error("nonliteral value");
      JSON.parse(token);
    }
  }
  while (index < tokens.length) {
    take("export"); take("const");
    if (!identifier.test(tokens[index++] ?? "")) throw new Error("invalid export name");
    take("="); value();
    if (tokens[index] === "as") { take("as"); take("const"); }
    take(";");
  }
}

export function assertOpenPresentationBoundary(paths, readSource = readFileSync) {
  for (const path of paths.filter(openPresentationPath)) {
    const source = readSource(path, "utf8");
    // A keyword denylist is not a capability boundary. Only exported data
    // literals are accepted: no calls, getters, computed access, or executable code.
    try { assertLiteralExports(source); } catch {
      throw new Error(`open presentation file crosses the literal-only boundary: ${path}`);
    }
  }
}

function openProductPath(path) {
  return OPEN_DOCUMENT(path) || OPEN_ASSET(path) || OPEN_PREVIEW(path) || OPEN_QA(path) ||
    openEventPath(path) || openPresentationPath(path) ||
    path === "site/dist/index.html" || path === "site/dist/404.html";
}

export function deploymentTargets(paths) {
  const targets = new Set();
  for (const path of paths) {
    if (OPEN_DOCUMENT(path) || OPEN_PREVIEW(path) || OPEN_QA(path) || GUIDE_PATHS.has(path)) continue;
    if (path.startsWith("migrations/")) targets.add("migrations");
    else if (RUNNER_PATHS(path)) targets.add("runner");
    else if (path.startsWith("src/")) targets.add("core-worker");
    else if (path.startsWith("event-site/")) targets.add("open-events");
    else if (path.startsWith("site/")) {
      targets.add("site-worker");
      if (OPEN_EVENT_PATHS.has(path)) targets.add("open-events");
    } else if (CORE_WORKER_PATH(path)) {
      // Shared build/dependency/config changes are protected and may affect all bundles.
      targets.add("core-worker");
      targets.add("site-worker");
      targets.add("open-events");
    }
  }
  return ["migrations", "core-worker", "site-worker", "open-events", "runner"].filter(target => targets.has(target));
}

function adapterFor(paths) {
  const targets = deploymentTargets(paths);
  return targets.length === 0 ? "repository" :
    targets.length === 1 && targets[0] !== "migrations" ? targets[0] : "production";
}

export function approvalDigest(policy) {
  return createHash("sha256").update(JSON.stringify({
    version: 2, changeClass: policy.changeClass, paths: policy.paths,
    adapter: policy.adapter, targets: deploymentTargets(policy.paths),
  })).digest("hex");
}

export function classifyChangePaths(paths) {
  const ordered = [...new Set(paths)].sort();
  if (ordered.length === 0) return { changeClass: "core", adapter: "manual", paths: ordered };
  if (ordered.some(path => path.startsWith("/") || path.split("/").some(part => part === ".." || part === "." || !part)))
    return { changeClass: "core", adapter: "manual", paths: ordered };
  if (ordered.every(openProductPath))
    return { changeClass: "open", adapter: adapterFor(ordered), paths: ordered };
  if (ordered.every(path => PRODUCTION_PATH(path) || RUNNER_PATHS(path) || GUIDE_PATHS.has(path) || openProductPath(path) || path.startsWith("event-site/")))
    return { changeClass: "core", adapter: adapterFor(ordered), paths: ordered };
  return { changeClass: "core", adapter: "manual", paths: ordered };
}

export function includesMigration(paths, version) {
  return paths.some((path) => MIGRATION_PATH.exec(path)?.[1] === version);
}
