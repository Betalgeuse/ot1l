import assert from "node:assert/strict";
import { approvalDigest, classifyChangePaths, deploymentTargets } from "../automation/runner/change-policy.mjs";

assert.deepEqual(
  classifyChangePaths([
    "event-site/src/index.ts",
    "site/dist/event-schedule.html",
    "site/dist/event-schedule.js",
  ]),
  {
    changeClass: "open",
    adapter: "production",
    paths: [
      "event-site/src/index.ts",
      "site/dist/event-schedule.html",
      "site/dist/event-schedule.js",
    ],
  },
);
assert.deepEqual(classifyChangePaths(["src/community-runtime.ts"]), {
  changeClass: "core",
  adapter: "core-worker",
  paths: ["src/community-runtime.ts"],
});
assert.equal(
  classifyChangePaths(["event-site/src/index.ts", "migrations/067_flexible_townhall_event.sql"])
    .changeClass,
  "core",
);
assert.equal(classifyChangePaths(["site/src/index.ts"]).adapter, "site-worker");
assert.equal(classifyChangePaths(["event-site/wrangler.jsonc"]).changeClass,"core");
assert.equal(classifyChangePaths(["automation/runner/genquant-runner.mjs"]).adapter, "runner");
assert.equal(
  classifyChangePaths(["event-site/src/index.ts", "src/community-runtime.ts"])
    .changeClass,
  "core",
);
const design = ["site/DESIGN.md", "site/dist/styles.css", "site/qa/event-schedule.mjs"];
assert.equal(classifyChangePaths(design).changeClass, "open", "PR #136 must not require Founder for a design document");
assert.deepEqual(deploymentTargets(design), ["site-worker", "open-events"], "shared CSS must reach BOTH consumers");
for (const paths of [
  ["docs/CONTRIBUTION_FLOW.md"],
  ["design-preview/index.html", "design-preview/README.md"],
  ["site/dist/index.html", "site/dist/assets/logo.png", "site/DESIGN.md"],
  ["src/slack-presentation/product-owner-approval.ts", "qa/example.mjs", "README.md"],
  [...design, "src/slack-presentation/product-owner-approval.ts"],
]) assert.equal(classifyChangePaths(paths).changeClass, "open", paths.join(", "));
assert.deepEqual(deploymentTargets(["design-preview/index.html", "docs/ARCHITECTURE.md", "qa/example.mjs"]), []);
assert.equal(classifyChangePaths(["design-preview/index.html"]).adapter, "repository");
assert.deepEqual(deploymentTargets([...design, "src/slack-presentation/product-owner-approval.ts"]),
  ["core-worker", "site-worker", "open-events"], "PO approval can deploy all three Worker targets");
for (const path of ["site/src/index.ts", "site/dist/app.js", "site/dist/receipt.html", "site/dist/interest.html",
  "src/community-feedback.ts", "migrations/081_founder_open_approval.sql", "automation/runner/change-policy.mjs",
  "qa/genquant-runner-contract.mjs", "event-site/wrangler.jsonc", "package.json", "AGENTS.md", ".github/workflows/release.yml"])
  assert.equal(classifyChangePaths([...design, path]).changeClass, "core", path);
for (const path of ["docs/../src/index.ts", "/site/dist/index.html", "site//dist/index.html"])
  assert.equal(classifyChangePaths([path]).adapter, "manual");
const policy = classifyChangePaths(design);
assert.notEqual(approvalDigest(policy), approvalDigest({...policy,adapter:"open-events"}), "approval binds deployment recipe");
console.log("PASS PO product deployment across Worker targets, protected capabilities and shared CSS consumers");
