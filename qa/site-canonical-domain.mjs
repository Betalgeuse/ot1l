import assert from "node:assert/strict";
import siteWorker, { CANONICAL_ORIGIN } from "../site/src/index.ts";

assert.equal(CANONICAL_ORIGIN, "https://ot1l.hyuk.me");

const html = await Bun.file("site/dist/index.html").text();
const env = {
  ASSETS: { async fetch() { return new Response(html, { headers: { "content-type": "text/html" } }); } },
  CORE: { async fetch() { throw new Error("legacy redirect must not call core"); } },
  RATE_LIMITER: { async limit() { return { success: true }; } },
};
const legacy = await siteWorker.fetch(new Request(`https://otl1.hyuk.me/join?from=old`), env);
assert.equal(legacy.status, 308);
assert.equal(legacy.headers.get("location"), `https://ot1l.hyuk.me/join?from=old`);
const homepage = await siteWorker.fetch(new Request("https://ot1l.hyuk.me/"), env);
assert.equal(homepage.status, 200);
const rendered = await homepage.text();
assert.match(rendered, /<link rel="canonical" href="https:\/\/ot1l\.hyuk\.me\/">/);
assert.doesNotMatch(rendered, /https:\/\/otl1\.hyuk\.me/);
console.log("PASS canonical OT1L domain and path-preserving legacy redirect");
