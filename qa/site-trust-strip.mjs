import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const html = await readFile("site/dist/index.html", "utf8");
const css = await readFile("site/dist/styles.css", "utf8");
const garden = /<section class="chapter chapter--leaf chapter--reactions"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
const section = /<aside class="affiliation-marquee[\s\S]*?<\/aside>/.exec(garden)?.[0] ?? "";
for (const affiliation of ["서울대학교 농업생명과학대학", "서울대학교 공과대학", "서울대학교 경영전문대학원", "배달의민족", "포스텍", "카이스트", "비상교육", "삼성", "전남대학교 의과대학"]) {
  assert.match(section, new RegExp(`alt="${affiliation}"`));
}
for (const asset of ["snu-cals.png", "snu-engineering.png", "snu-mba.png", "baemin.png", "postech.png", "kaist.gif", "visang.png", "samsung.png", "jnu-medical.png"]) {
  assert.equal(section.match(new RegExp(`/assets/affiliations/${asset.replace(".", "\\.")}`, "g"))?.length, 2);
}
assert.doesNotMatch(section, /\/assets\/affiliations\/snu\.png/);
assert.doesNotMatch(section, /현재·이전 소속|공식 제휴|후원|Trusted by/);
assert.match(css, /@keyframes affiliation-marquee\{to\{transform:translateX\(-50%\)\}\}/);
assert.match(css, /prefers-reduced-motion:reduce[\s\S]*?\.affiliation-track\{animation:none\}/);
console.log("PASS approved affiliation logos loop left inside the member section");
