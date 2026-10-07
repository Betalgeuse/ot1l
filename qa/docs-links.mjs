import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const documents = ["README.md", "AGENTS.md", "CONTRIBUTING.md", "site/DESIGN.md"];

function collect(directory) {
  for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (path.startsWith("docs/vendor/")) continue;
    if (entry.isDirectory()) collect(path);
    else if (entry.isFile() && extname(entry.name) === ".md") documents.push(path);
  }
}

collect("docs");

for (const document of documents.sort()) {
  const source = readFileSync(resolve(root, document), "utf8");
  for (const [, destination] of source.matchAll(/!?(?:\[[^\]]*\])\(([^)]+)\)/g)) {
    if (/^(?:https?:|mailto:|slack:|#)/.test(destination)) continue;
    const path = decodeURIComponent(destination.split(/[?#]/, 1)[0]);
    if (!path) continue;
    const target = resolve(root, dirname(document), path);
    assert.ok(
      existsSync(target),
      relative(root, resolve(root, document)) + " links to missing " + destination,
    );
  }
}

console.log(
  "PASS " + documents.length + " first-party Markdown documents have resolvable local links",
);
