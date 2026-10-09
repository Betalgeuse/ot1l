import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertOpenPresentationBoundary,
  classifyChangePaths,
} from "../automation/runner/change-policy.mjs";

const presentation = "src/slack-presentation/product-owner-approval.ts";
assert.deepEqual(classifyChangePaths([presentation]), {
  changeClass: "open",
  adapter: "core-worker",
  paths: [presentation],
});
assert.doesNotThrow(() => assertOpenPresentationBoundary([presentation]));

for (const source of [
  'import { value } from "../core";',
  "const value = process.env.VALUE;",
  'fetch("https://example.test");',
  'const secret = "value";',
  'const query = "SELECT 1";',
  'const api = "/actions";',
  'const router = "feedback";',
  'const actor = "A123";',
  'const member = "M123";',
  'const role = "owner";',
  'const email = "person@example.test";',
  'const broker = "runner";',
  'export const TEXT = globalThis["fe" + "tch"]("https://example.test");',
  'export const TEXT = { get title() { return "oops"; } };',
  'export const TEXT = { ["ti" + "tle"]: "oops" };',
  'export const TEXT = { __proto__: { value: "oops" } };',
  'export const TEXT = (() => "oops")();',
  'export const TEXT = { ...other };',
]) {
  assert.throws(
    () => assertOpenPresentationBoundary([presentation], () => source),
    /open presentation file crosses/,
  );
}

assert.equal(classifyChangePaths(["src/slack-presentation.ts"]).changeClass, "core");
assert.equal(classifyChangePaths(["src/slack-presentation/nested/file.ts"]).changeClass, "core");
assert.equal(classifyChangePaths([presentation, "src/index.ts"]).changeClass, "core");
assert.deepEqual(classifyChangePaths([presentation, "qa/example.mjs"]), {
  changeClass: "open",
  adapter: "core-worker",
  paths: ["qa/example.mjs", presentation],
});

const runner = readFileSync("automation/runner/genquant-runner.mjs", "utf8");
const deployer = readFileSync("automation/runner/genquant-deployer.mjs", "utf8");
assert.match(
  runner,
  /assertOpenPresentationBoundary\(paths[\s\S]+?"pr",\s*"create"/,
  "the runner must inspect sources before PR creation",
);
assert.match(
  runner,
  /"headRefOid,files"[\s\S]+?assertOpenPresentationBoundary\(paths[\s\S]+?"pr",\s*"merge"/,
  "the merge runner must inspect the live PR immediately before merging",
);
const approvalCheck = deployer.lastIndexOf("verifyApprovedPaths(claim");
const preMergeCheck = deployer.indexOf("assertOpenPresentationBoundary(policy.paths", approvalCheck);
const checkoutMerge = deployer.indexOf('"--ff-only"', preMergeCheck);
const postMergeCheck = deployer.indexOf("assertOpenPresentationBoundary(deployedPaths", checkoutMerge);
assert.ok(
  approvalCheck < preMergeCheck && preMergeCheck < checkoutMerge && checkoutMerge < postMergeCheck,
  "the deployer must inspect the exact paths before and after its checkout merge",
);

console.log("PASS Slack presentation Open boundary and fail-closed content guard");
