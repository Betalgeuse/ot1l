import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { analyze, scanImports } from "../scripts/reach.mjs";

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
  put("src/broken-entry.ts", 'import "./does-not-exist";\n');
  put("src/computed-entry.ts", 'const name = "./x";\nawait import(name);\n');

  const live = analyze(root, ["src/entry.ts", "src/entry-two.ts", "src/entry-comment.ts"]).status;
  for (const file of ["entry", "chain-a", "chain-b", "side-effect", "lazy", "types", "index-dir/index"])
    assert.equal(live.get(`src/${file}.ts`), "live", `${file} should be live through its import chain`);
  for (const file of ["unreached", "only-by-unreached", "commented"])
    assert.equal(live.get(`src/${file}.ts`), "dead", `${file} should be dead`);

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
