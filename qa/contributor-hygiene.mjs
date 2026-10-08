import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyChangePaths } from "../automation/runner/change-policy.mjs";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const readme = read("README.md");
const contributing = read("CONTRIBUTING.md");
const agents = read("AGENTS.md");
const maintainerGuide = read("docs/EVENTS_AND_MAINTAINERS.md");

assert.match(readme, /CONTRIBUTING[.]md/);
for (const document of [contributing, agents]) {
  assert.match(document, /otl1-time/);
  assert.match(document, /otl1-onething-garden/);
  assert.match(document, /automation\/runner\/change-policy[.]mjs/);
  assert.match(document, /fork/i);
}
assert.match(contributing, /PR 연결하기/);
assert.match(contributing, /격리 환경/);
assert.match(maintainerGuide, /GitHub collaborator 초대.*않/);
assert.match(maintainerGuide, /개인 컴퓨터에서 운영 Worker를 배포하지 않습니다/);
assert.doesNotMatch(maintainerGuide, /otl1-open-events/);
assert.equal(classifyChangePaths(["event-site/src/index.ts"]).adapter, "open-events");
assert.equal(classifyChangePaths(["src/community-townhall-events.ts"]).adapter, "core-worker");
assert.equal(
  classifyChangePaths(["event-site/src/index.ts", "src/community-townhall-events.ts"])
    .changeClass,
  "core",
);

console.log("PASS contributor hygiene: public fork flow, Worker routing, and authority boundaries stay explicit");
