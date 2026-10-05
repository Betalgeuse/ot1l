import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../scripts/deploy-production-site.mjs", import.meta.url), "utf8");
assert.match(source, /config[.]name !== "otl1-site"/);
assert.match(source, /service !== "otl1-onething-garden"/);
assert.match(source, /--keep-vars/);
assert.match(source, /Use --apply/);
assert.doesNotMatch(source, /CLOUDFLARE_API_TOKEN/);
console.log("PASS production site deploy guard pins site, Core binding and preserves secrets");
