import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyChangePaths } from "../automation/runner/change-policy.mjs";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const readme = read("README.md");
const contributing = read("CONTRIBUTING.md");
const agents = read("AGENTS.md");
const maintainerGuide = read("docs/MAINTAINER_WORKFLOW.md");
const eventGuide = read("docs/EVENTS.md");

assert.match(readme, /CONTRIBUTING[.]md/);
for (const document of [contributing, agents]) {
  assert.match(document, /otl1-time/);
  assert.match(document, /otl1-onething-garden/);
  assert.match(document, /automation\/runner\/change-policy[.]mjs/);
  assert.match(document, /fork/i);
}
assert.match(contributing, /셀프서비스 버튼은 아직 없습니다/);
assert.match(maintainerGuide, /GitHub collaborator 초대.*않/);
assert.match(maintainerGuide, /개인 컴퓨터에서 운영 Worker를 직접 배포하지 않/);
assert.doesNotMatch(maintainerGuide, /otl1-open-events/);
assert.match(eventGuide, /시간 미정 이벤트 열기/);
assert.match(eventGuide, /00분.*30분/);
assert.equal(classifyChangePaths(["event-site/src/index.ts"]).adapter, "open-events");
assert.equal(classifyChangePaths(["site/dist/event-schedule.css"]).adapter, "open-events");
assert.equal(classifyChangePaths(["site/dist/styles.css"]).adapter, "site");
assert.equal(classifyChangePaths(["src/community-townhall-events.ts"]).adapter, "core-worker");
assert.equal(
  classifyChangePaths(["event-site/src/index.ts", "src/community-townhall-events.ts"])
    .changeClass,
  "core",
);

console.log("PASS contributor hygiene: public fork flow, Worker routing, and authority boundaries stay explicit");
