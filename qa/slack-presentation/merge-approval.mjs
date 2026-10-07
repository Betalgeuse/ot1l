import assert from "node:assert/strict";
import {
  mergeApprovalAudience,
  mergeApprovalButtonLabel,
} from "../../src/slack-presentation/merge-approval.ts";

assert.match(mergeApprovalAudience("open"), /Product Owner 또는 Founder/);
assert.match(mergeApprovalAudience("core"), /Founder 승인/);
assert.equal(mergeApprovalButtonLabel("open"), "Product Owner 병합·배포 승인");
assert.equal(mergeApprovalButtonLabel("core"), "Founder 병합·배포 승인");

console.log("PASS Slack presentation: approval audience and button copy follow change class");
