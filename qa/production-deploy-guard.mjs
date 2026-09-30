import assert from "node:assert/strict";
import { validateProductionConfig } from "../scripts/deploy-production-worker.mjs";

const valid = {
  name: "otl1-onething-garden",
  r2_buckets: [
    { binding: "BUG_PRIVATE_OBJECTS", bucket_name: "otl1-bug-private" },
    { binding: "INVITE_PRIVATE_OBJECTS", bucket_name: "otl1-invite-private" },
  ],
  triggers: { crons: ["0 1 * * *", "0 9 * * *", "*/5 * * * *"] },
};
assert.equal(validateProductionConfig(valid), valid);
assert.throws(
  () => validateProductionConfig({ ...valid, name: "onething-community" }),
  /name mismatch/,
);
assert.throws(
  () => validateProductionConfig({ ...valid, vars: { COMMUNITY_CHANNEL_ID: "C_REPLACE" } }),
  /placeholders/,
);
assert.throws(
  () => validateProductionConfig({ ...valid, triggers: { crons: ["*/5 * * * *"] } }),
  /redundancy/,
);
assert.throws(
  () => validateProductionConfig({ ...valid, r2_buckets: [] }),
  /R2 binding/,
);
console.log("PASS production deploy rejects example Worker, placeholder values, wrong R2, and missing exact crons");
