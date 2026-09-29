import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { githubRepositorySlug, sha256 } from "./contract.mjs";

const SHA = /^[a-f0-9]{40}$/;
const SAFE_ERROR = /^[a-z0-9_]{1,120}$/;
const log = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));

function command(binary, args, options = {}) {
  return execFileSync(binary, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeout ?? 60_000,
    maxBuffer: 4 * 1024 * 1024,
  }).trim();
}

export function classifyRunnerDeploymentPaths(paths) {
  const allowed = paths.every(
    (path) =>
      path.startsWith("automation/runner/") ||
      path === "qa/genquant-runner-contract.mjs" ||
      path === "qa/genquant-deployer-contract.mjs" ||
      path.startsWith("ops/genquant/") ||
      path.startsWith("docs/") ||
      path === "scripts/test-unit.mjs" ||
      path === "scripts/export-public-manifest.mjs",
  );
  return { automatic: allowed, paths: [...paths].sort() };
}

export function validateDeployerConfig(env) {
  for (const name of [
    "BUG_RUNNER_DATABASE_URL",
    "SLACK_TEAM_ID",
    "CODEX_REPOSITORY_URL",
    "CODEX_BASE_BRANCH",
    "BUG_DEPLOY_CHECKOUT",
    "BUG_DEPLOY_SERVICE",
  ])
    if (typeof env[name] !== "string" || !env[name].trim())
      throw new Error(`missing deployer config: ${name}`);
  try {
    githubRepositorySlug(env.CODEX_REPOSITORY_URL);
  } catch {
    throw new Error("invalid deploy repository URL");
  }
  if (!/^[A-Za-z0-9_.@-]+[.]service$/.test(env.BUG_DEPLOY_SERVICE))
    throw new Error("invalid deploy service");
  return env;
}

function sqlClient(connectionString) {
  const url = new URL(connectionString);
  if (!url.hostname.endsWith(".neon.tech")) throw new Error("invalid deployer database URL");
  return async (functionName, input) => {
    const response = await fetch(`https://${url.hostname}/sql`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Neon-Connection-String": connectionString,
        "Neon-Raw-Text-Output": "true",
        "Neon-Array-Mode": "true",
      },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ query: `SELECT otl.${functionName}($1::jsonb)`, params: [JSON.stringify(input)] }),
    });
    const body = await response.json();
    if (!response.ok || !Array.isArray(body.rows) || !Array.isArray(body.rows[0]))
      throw new Error(`deployment database call failed: ${functionName}`);
    return body.rows[0][0] === null ? null : JSON.parse(body.rows[0][0]);
  };
}

function deploymentRange(checkout, mergeSha, baseBranch) {
  command("git", ["fetch", "--no-tags", "origin", baseBranch], { cwd: checkout, timeout: 180_000 });
  command("git", ["merge-base", "--is-ancestor", mergeSha, `origin/${baseBranch}`], { cwd: checkout });
  const dirty = command("git", ["status", "--porcelain=v1", "--untracked-files=no"], { cwd: checkout });
  if (dirty) throw new Error("tracked_checkout_dirty");
  const current = command("git", ["rev-parse", "HEAD"], { cwd: checkout });
  if (current === mergeSha) return { current, paths: [] };
  try {
    command("git", ["merge-base", "--is-ancestor", current, mergeSha], { cwd: checkout });
  } catch {
    throw new Error("checkout_not_exact_ancestor");
  }
  const paths = command("git", ["diff", "--name-only", current, mergeSha], { cwd: checkout })
    .split("\n")
    .filter(Boolean);
  return { current, paths };
}

export async function deployOnce(environment = process.env) {
  const config = validateDeployerConfig(environment);
  const db = sqlClient(config.BUG_RUNNER_DATABASE_URL);
  const workerId = config.BUG_DEPLOY_WORKER_ID ?? "genquant-deployer";
  const leaseToken = randomUUID();
  const claim = await db("bug_runner_claim_deployment", {
    teamId: config.SLACK_TEAM_ID,
    workerId,
    leaseToken,
    now: new Date().toISOString(),
  });
  if (claim === null) return { claimed: false };
  const changeId = Number(claim.changeId);
  const mergeSha = String(claim.mergeSha ?? "");
  const jobId = Number(claim.jobId);
  if (!Number.isSafeInteger(changeId) || !Number.isSafeInteger(jobId) || !SHA.test(mergeSha))
    throw new Error("invalid deployment claim identity");
  const checkout = resolve(config.BUG_DEPLOY_CHECKOUT);
  try {
    const range = deploymentRange(checkout, mergeSha, config.CODEX_BASE_BRANCH);
    const policy = classifyRunnerDeploymentPaths(range.paths);
    if (!policy.automatic) {
      await db("bug_runner_fail_deployment", {
        teamId: config.SLACK_TEAM_ID,
        changeId,
        workerId,
        leaseToken,
        manualRequired: true,
        errorCode: "unsupported_deploy_paths",
        now: new Date().toISOString(),
      });
      log("bug.deployer.manual_required", { bugId: claim.bugId, changeId, pathCount: policy.paths.length });
      return { claimed: true, deployed: false, manualRequired: true };
    }
    if (range.current !== mergeSha)
      command("git", ["merge", "--ff-only", mergeSha], { cwd: checkout, timeout: 180_000 });
    command("bun", ["qa/genquant-runner-contract.mjs"], { cwd: checkout, timeout: 180_000 });
    command("systemctl", ["--user", "restart", config.BUG_DEPLOY_SERVICE], { timeout: 30_000 });
    const active = command("systemctl", ["--user", "is-active", config.BUG_DEPLOY_SERVICE]);
    if (active !== "active") throw new Error("service_not_active");
    const deployedSha = command("git", ["rev-parse", "HEAD"], { cwd: checkout });
    if (deployedSha !== mergeSha) throw new Error("deployed_sha_mismatch");
    const expectedBranch = `feedback/ot1-${jobId}-`;
    const branchProbe = command(
      "node",
      ["--input-type=module", "-e", `import {buildFixBranch} from './automation/runner/contract.mjs'; console.log(buildFixBranch(${JSON.stringify(claim.publicAlias)},${jobId}))`],
      { cwd: checkout },
    );
    if (!branchProbe.startsWith(expectedBranch)) throw new Error("branch_probe_failed");
    const environmentEvidence = { host: "genquant", checkout, mergeSha, deployedSha, service: config.BUG_DEPLOY_SERVICE, active };
    const observationEvidence = { contract: "genquant-runner-contract", branchProbe };
    const workerVersion = randomUUID();
    const result = await db("bug_runner_finish_deployment", {
      teamId: config.SLACK_TEAM_ID,
      bugId: claim.bugId,
      changeId,
      deployerId: claim.approvedBy,
      workerId,
      leaseToken,
      mergeSha,
      deployedSha,
      workerVersion,
      environmentReceipt: sha256(JSON.stringify(environmentEvidence)),
      observationReceipt: sha256(JSON.stringify(observationEvidence)),
      liveArtifacts: JSON.stringify({ environmentEvidence, observationEvidence }),
      summary: `GenQuant runner를 ${mergeSha.slice(0, 7)}로 자동 배포하고 계약 테스트·서비스 active·OT1 브랜치 규칙을 확인했습니다.`,
    });
    log("bug.deployer.deployed", { bugId: claim.bugId, changeId, mergeSha, workerVersion });
    return { claimed: true, deployed: true, result };
  } catch (error) {
    const errorCode = String(error instanceof Error ? error.message : "deployment_failed")
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .slice(0, 120) || "deployment_failed";
    await db("bug_runner_fail_deployment", {
      teamId: config.SLACK_TEAM_ID,
      changeId,
      workerId,
      leaseToken,
      manualRequired: false,
      errorCode: SAFE_ERROR.test(errorCode) ? errorCode : "deployment_failed",
      now: new Date().toISOString(),
    });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href)
  deployOnce().then((result) => log("bug.deployer.complete", result)).catch((error) => {
    log("bug.deployer.failed", { errorType: error instanceof Error ? error.name : "Unknown" });
    process.exitCode = 1;
  });
