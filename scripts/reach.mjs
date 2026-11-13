// Reach checker: which src files can a real entry point reach through static imports?
// Statuses: live, dead, inconclusive (live file whose imports cannot all be resolved statically).
// Usage: node scripts/reach.mjs [--root <dir>] [--entry <file>]... [--check]
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs"];

function listSources(root, dir = "src") {
  const out = [];
  for (const name of readdirSync(join(root, dir))) {
    const path = `${dir}/${name}`;
    if (statSync(join(root, path)).isDirectory()) out.push(...listSources(root, path));
    else if (SOURCE_EXTENSIONS.some((extension) => name.endsWith(extension))) out.push(path);
  }
  return out.sort();
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

// Returns literal specifiers and a flag for any import/require whose target is not a string literal.
export function scanImports(text) {
  const code = stripComments(text);
  const specifiers = new Set();
  let computed = false;
  for (const match of code.matchAll(/(?:^|[\s;{}])(?:import|export)\s[^;]*?\sfrom\s*(["'])([^"']+)\1/g))
    specifiers.add(match[2]);
  for (const match of code.matchAll(/(?:^|[\s;{}])import\s*(["'])([^"']+)\1/g)) specifiers.add(match[2]);
  for (const match of code.matchAll(/\b(?:import|require)\s*\(\s*([^)]*?)\s*\)/g)) {
    const literal = /^(["'])([^"'`]+)\1$/.exec(match[1] ?? "");
    if (literal?.[2]) specifiers.add(literal[2]);
    else computed = true;
  }
  return { specifiers: [...specifiers], computed };
}

function resolveSpecifier(root, from, specifier, known) {
  if (!specifier.startsWith(".")) return { external: true };
  const base = join(dirname(from), specifier).replaceAll("\\", "/");
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => `${base}/index${extension}`),
  ];
  const hit = candidates.find((candidate) => known.has(candidate));
  if (hit) return { path: hit };
  const outside = candidates.some((candidate) => existsSync(join(root, candidate)));
  return outside ? { external: true } : { unresolved: true };
}

// Worker entries declared by wrangler.jsonc at the root and in each subdirectory, when they point into src.
export function wranglerMain(root) {
  const configs = ["wrangler.jsonc", ...readdirSync(root).map((name) => `${name}/wrangler.jsonc`)];
  const mains = [];
  for (const config of configs) {
    if (!existsSync(join(root, config))) continue;
    const text = readFileSync(join(root, config), "utf8").split("\n").filter((line) => !/^\s*\/\//.test(line)).join("\n");
    const main = /"main"\s*:\s*"([^"]+)"/.exec(text)?.[1];
    if (!main) continue;
    const path = join(dirname(config), main).replaceAll("\\", "/");
    if (path.startsWith("src/")) mains.push(path);
  }
  return mains;
}

export function analyze(root, entries) {
  const files = listSources(root);
  const known = new Set(files);
  const status = new Map(files.map((file) => [file, "dead"]));
  const reasons = new Map();
  const queue = entries.filter((entry) => known.has(entry));
  for (const entry of entries) if (!known.has(entry)) reasons.set(entry, ["entry missing"]);
  for (const file of queue) status.set(file, "live");
  while (queue.length > 0) {
    const file = queue.pop();
    const { specifiers, computed } = scanImports(readFileSync(join(root, file), "utf8"));
    const problems = computed ? ["non-literal import/require"] : [];
    for (const specifier of specifiers) {
      const target = resolveSpecifier(root, file, specifier, known);
      if (target.unresolved) problems.push(`unresolved ${specifier}`);
      if (target.path && status.get(target.path) === "dead") {
        status.set(target.path, "live");
        queue.push(target.path);
      }
    }
    if (problems.length > 0) {
      status.set(file, "inconclusive");
      reasons.set(file, problems);
    }
  }
  return { status, reasons };
}

function main(argv) {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  let base = root;
  const entries = [];
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root") base = resolve(argv[++index] ?? ".");
    else if (argv[index] === "--entry") entries.push(argv[++index] ?? "");
    else if (argv[index] === "--check") check = true;
  }
  const roots = entries.length > 0 ? entries : ["src/worker-entry.ts", ...wranglerMain(base)];
  const { status, reasons } = analyze(base, [...new Set(roots)]);
  const rows = (name) => [...status].filter(([, value]) => value === name).map(([file]) => file);
  const dead = rows("dead");
  const inconclusive = rows("inconclusive");
  console.log(`entries: ${roots.join(", ")}`);
  console.log(`live ${rows("live").length}, inconclusive ${inconclusive.length}, dead ${dead.length}`);
  for (const file of inconclusive) console.log(`inconclusive ${file}: ${(reasons.get(file) ?? []).join("; ")}`);
  for (const file of dead) console.log(`dead ${relative(base, join(base, file))}`);
  if (check && (dead.length > 0 || inconclusive.length > 0)) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
