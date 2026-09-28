import assert from "node:assert/strict";
import siteWorker from "../site/src/index.ts";

const token = "C".repeat(32);
const assetReads = [];
const assets = {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    assetReads.push(path);
    if (path === "/index.html") return new Response(await Bun.file("site/dist/index.html").text(), { headers: { "content-type": "text/html" } });
    if (path === "/referral.html") return new Response(await Bun.file("site/dist/referral.html").text(), { headers: { "content-type": "text/html" } });
    return new Response("not found", { status: 404 });
  },
};
const env = {
  ASSETS: assets,
  CORE: { async fetch() { return Response.json({ available: true, inviterName: "초대한 사람" }); } },
  RATE_LIMITER: { async limit() { return { success: true }; } },
  TURNSTILE_SITE_KEY: "test-site-key",
  SITE_CORE_HMAC_SECRET: "test-signing-secret-with-enough-entropy",
  SLACK_SHARED_INVITE_URL: "https://join.slack.com/t/otl1/shared_invite/zt-synthetic-token",
  PUBLIC_INTEREST_ENABLED: "false",
};

const referral = await siteWorker.fetch(new Request(`https://otl1.hyuk.me/r/${token}`), env);
assert.equal(referral.status, 200);
const referralHtml = await referral.text();
assert.deepEqual(assetReads, ["/index.html"], "referral must render from the canonical homepage asset only");

assetReads.length = 0;
const homepage = await siteWorker.fetch(new Request("https://otl1.hyuk.me/"), env);
const homepageHtml = await homepage.text();
assert.deepEqual(assetReads, ["/index.html"]);

const sectionCount = (html) => html.match(/<section\b/g)?.length ?? 0;
assert.equal(sectionCount(referralHtml), sectionCount(homepageHtml) + 1, "referral adds exactly one section");
assert.ok(referralHtml.indexOf('id="referral-invite"') < referralHtml.indexOf('id="home"'), "invite section must come first");
assert.match(referralHtml, />같이 원띵 해요<\/p>/);
assert.match(referralHtml, /초대한 사람 님이 같이 원띵 하자고 초대했어요\./);
assert.doesNotMatch(referralHtml, /같이 성장/);
assert.match(referralHtml, /href="\/join"/);
assert.match(referralHtml, /data-copy/);
assert.match(referralHtml, /alt="전남대학교 의과대학"/);
assert.equal(referralHtml.match(/class="affiliation-marquee/g)?.length, 1);
assert.doesNotMatch(referralHtml, /application-form-section|__REFERRAL_|__INVITER_|__SHARE_|__INTEREST_/);
assert.match(referralHtml, /<link rel="canonical" href="https:\/\/otl1\.hyuk\.me\/r\/C{32}">/);
assetReads.length = 0;
const retiredTemplate = await siteWorker.fetch(new Request("https://otl1.hyuk.me/referral.html"), env);
assert.equal(retiredTemplate.status, 404);
assert.deepEqual(assetReads, [], "retired referral template must not reach static assets");
console.log("PASS referral composes one invite section above the canonical homepage");
