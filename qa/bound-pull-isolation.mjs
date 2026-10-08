import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isolatedCheckArgs } from "../automation/runner/bound-pull.mjs";
if (process.platform !== "linux") throw new Error("Run this isolation acceptance test on the Linux broker");
const work = mkdtempSync(join(tmpdir(), "otl1-isolation-qa-"));
try {
  writeFileSync(join(work, "package.json"), JSON.stringify({ scripts: { check: "node check.cjs" } }));
  writeFileSync(join(work, "check.cjs"), `
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    assert.equal(process.env.OTL1_ISOLATION_SENTINEL, undefined);
    assert.equal(fs.existsSync('/home/opc/.config'), false);
    assert.equal(fs.existsSync('/home/opc/otl1-bug-runner'), false);
    assert.equal(fs.existsSync('/run'), false);
    assert.deepEqual(Object.keys(require('node:os').networkInterfaces()).filter(n => n !== 'lo'), []);
    console.log('PASS real broker isolation: no inherited secret, host home, repository or network');
  `);
  const bun = realpathSync(execFileSync("which", ["bun"], { encoding:"utf8" }).trim());
  const output = execFileSync("bwrap", isolatedCheckArgs(work, bun, realpathSync(process.execPath), false), {
    encoding:"utf8", env:{...process.env,OTL1_ISOLATION_SENTINEL:"fixture-only"}, timeout:30_000,
  });
  assert.match(output, /PASS real broker isolation/);
  console.log(output.trim());
} finally { rmSync(work, {recursive:true,force:true}); }
