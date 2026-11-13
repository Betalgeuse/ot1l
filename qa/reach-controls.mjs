import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { analyze, readKeep, scanImports } from "../scripts/reach.mjs";

import { stripComments } from "../scripts/reach.mjs";
const stripCommentsCheck = () =>
  stripComments('const a = "/* x */"; /* gone */ const b = 1; // tail').includes('"/* x */"') &&
  !stripComments('const a = 1; /* gone */').includes("gone");
const root = mkdtempSync(join(tmpdir(), "reach-controls-"));
const put = (path, text) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};
try {
  put("src/entry.ts", 'import { a } from "./chain-a";\nimport type { T } from "./types";\nexport { a };\n');
  put("src/chain-a.ts", 'export * from "./chain-b";\nexport const a = 1;\n');
  put("src/chain-b.ts", 'import "./side-effect";\nexport const b = import("./lazy");\n');
  put("src/side-effect.ts", "export {};\n");
  put("src/lazy.ts", "export {};\n");
  put("src/types.ts", "export type T = string;\n");
  put("src/index-dir/index.ts", "export {};\n");
  put("src/entry-two.ts", 'import "./index-dir";\n');
  put("src/unreached.ts", 'import "./only-by-unreached";\n');
  put("src/only-by-unreached.ts", "export {};\n");
  put("src/commented.ts", "export {};\n");
  put("src/entry-comment.ts", '// import "./commented";\n/* import "./commented"; */\nexport {};\n');
  put("src/after-string.ts", "export {};\n");
  put("src/after-url.ts", "export {};\n");
  put("src/entry-strings.ts", 'const glob = "src/*";\nimport "./after-string";\nconst url = "http://x"; import "./after-url";\nconst end = "*/";\n');
  put("src/kept.ts", 'import "./kept-child";\n');
  put("src/kept-child.ts", "export {};\n");
  put("src/broken-entry.ts", 'import "./does-not-exist";\n');
  put("src/computed-entry.ts", 'const name = "./x";\nawait import(name);\n');

  const live = analyze(root, ["src/entry.ts", "src/entry-two.ts", "src/entry-comment.ts"]).status;
  for (const file of ["entry", "chain-a", "chain-b", "side-effect", "lazy", "types", "index-dir/index"])
    assert.equal(live.get(`src/${file}.ts`), "live", `${file} should be live through its import chain`);
  for (const file of ["unreached", "only-by-unreached", "commented"])
    assert.equal(live.get(`src/${file}.ts`), "dead", `${file} should be dead`);

  const strings = analyze(root, ["src/entry-strings.ts"]).status;
  for (const file of ["after-string", "after-url"])
    assert.equal(strings.get(`src/${file}.ts`), "live", `${file} follows a string holding a comment marker`);
  assert.equal(stripCommentsCheck(), true);

  const keep = [{ path: "src/kept.ts", reason: "control" }];
  const kept = analyze(root, ["src/entry.ts"], keep).status;
  assert.equal(kept.get("src/kept.ts"), "keep");
  assert.equal(kept.get("src/kept-child.ts"), "live", "imports of a kept file are live");
  assert.equal(kept.get("src/unreached.ts"), "dead", "keep does not rescue other files");
  assert.equal(analyze(root, ["src/entry.ts"], [{ path: "src/nope.ts", reason: "x" }]).reasons.get("src/nope.ts")[0], "entry missing");
  put("ops/reach-keep.txt", "# note\nsrc/kept.ts why\n");
  assert.deepEqual(readKeep(root), [{ path: "src/kept.ts", reason: "why" }]);
  put("ops/reach-keep.txt", "src/kept.ts\n");
  assert.throws(() => readKeep(root), /needs a reason/);

  const broken = analyze(root, ["src/broken-entry.ts"]);
  assert.equal(broken.status.get("src/broken-entry.ts"), "inconclusive");
  const computed = analyze(root, ["src/computed-entry.ts"]);
  assert.equal(computed.status.get("src/computed-entry.ts"), "inconclusive");
  assert.deepEqual(computed.reasons.get("src/computed-entry.ts"), ["non-literal import/require"]);
  assert.equal(computed.status.get("src/entry.ts"), "dead");

  assert.deepEqual(scanImports('import a, { b } from "./one";\nexport type { C } from "./two";\nimport("./three");').specifiers.sort(), ["./one", "./three", "./two"]);
  console.log("PASS reach controls: chain live, unreached dead, unresolved and non-literal imports inconclusive");
} finally {
  rmSync(root, { recursive: true, force: true });
}
