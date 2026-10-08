import assert from "node:assert/strict";
import { isolatedCheckArgs, verifyBoundPullRequest } from "../automation/runner/bound-pull.mjs";
import { maintainerWorkGuide } from "../src/community-maintainer-retention.ts";
import { readOpenPullRequest } from "../src/community-pull-request.ts";

const request = async (url) => {
  if (url.endsWith("/pulls/17"))
    return Response.json({
      state: "open",
      base: { ref: "main", repo: { full_name: "Betalgeuse/ot1l" } },
      head: { sha: "a".repeat(40), repo: { full_name: "contributor/ot1l" } },
    });
  return Response.json([
    { filename: "event-site/src/index.ts" },
    { filename: "site/qa/event-schedule.mjs" },
  ]);
};
const pull = await readOpenPullRequest("https://github.com/Betalgeuse/ot1l/pull/17", request);
assert.equal(pull.headSha, "a".repeat(40));
assert.deepEqual(pull.paths, ["event-site/src/index.ts", "site/qa/event-schedule.mjs"]);
await assert.rejects(
  () => readOpenPullRequest("https://github.com/evil/fork/pull/17", request),
  /형식만/,
);
assert.equal(maintainerWorkGuide().blocks[1].elements[1].text.text, "PR 연결하기");

const calls = [];
let isDraft = false;
const run = (binary, args) => {
  calls.push([binary, args]);
  if (binary === "which") return process.execPath;
  if (binary === "gh")
    return JSON.stringify({
      state: "OPEN",
      isDraft,
      baseRefName: "main",
      headRepository: { nameWithOwner: "Betalgeuse/ot1l" },
      headRefOid: "a".repeat(40),
      files: [{ path: "event-site/src/index.ts" }],
    });
  if (args.at(-1) === "FETCH_HEAD") return "a".repeat(40);
  return "";
};
const classification = verifyBoundPullRequest(
  "/repo",
  "Betalgeuse/ot1l",
  {
    repository: "Betalgeuse/ot1l",
    pr_number: 17,
    head_sha: "a".repeat(40),
    changed_paths: ["event-site/src/index.ts"],
  },
  run,
);
assert.equal(classification.changeClass, "open");
assert(calls.some(([binary, args]) => binary === "bwrap" && args.slice(-2).join(" ") === "run check"));
assert(calls.some(([binary, args]) => binary === "git" && args.includes("worktree") && args.includes("add")));
assert.equal(calls.some(([binary, args]) => binary === "git" && args.includes("checkout")), false);
const isolated = isolatedCheckArgs("/candidate", "/bun", "/node", false);
assert(isolated.includes("--clearenv") && isolated.includes("--unshare-all"));
assert.equal(isolated.includes("--share-net"), false);
assert.equal(isolated.includes("/home/opc"), false);
isDraft=true;
assert.throws(()=>verifyBoundPullRequest("/repo","Betalgeuse/ot1l",{repository:"Betalgeuse/ot1l",pr_number:17,head_sha:"a".repeat(40),changed_paths:["event-site/src/index.ts"]},run),/identity or paths changed/);
isDraft=false;
assert.throws(
  () =>
    verifyBoundPullRequest(
      "/repo",
      "Betalgeuse/ot1l",
      {
        repository: "Betalgeuse/ot1l",
        pr_number: 17,
        head_sha: "b".repeat(40),
        changed_paths: ["event-site/src/index.ts"],
      },
      run,
    ),
  /identity or paths changed/,
);
console.log("PASS po-work PR binding validates GitHub metadata and GenQuant exact-SHA checks");
