import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  assertOpenPresentationBoundary,
  classifyChangePaths,
  includesMigration,
} from "./change-policy.mjs";
import { githubRepositorySlug, sha256 } from "./contract.mjs";
import { applyForwardMigrations, migrationConnection } from "./migration-deployer.mjs";

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
    ...(options.env ? { env: options.env } : {}),
  }).trim();
}

function deployOpenEvents(checkout, config) {
  for (const name of [
    "CLOUDFLARE_API_TOKEN",
    "OTL1_OPEN_EVENTS_WRANGLER_CONFIG",
    "BUG_DEPLOY_OPEN_EVENTS_HEALTH_URL",
  ])
    if (typeof config[name] !== "string" || !config[name].trim())
      throw new Error("open_events_deployer_unconfigured");
  const productionConfig = resolve(config.OTL1_OPEN_EVENTS_WRANGLER_CONFIG);
  command("bun", ["install", "--frozen-lockfile"], { cwd: checkout, timeout: 180_000 });
  command("bun", ["run", "check"], { cwd: checkout, timeout: 20 * 60_000 });
  command("node", ["scripts/deploy-open-events-worker.mjs"], {
    cwd: checkout,
    timeout: 10 * 60_000,
    env: {
      ...process.env,
      CLOUDFLARE_API_TOKEN: config.CLOUDFLARE_API_TOKEN,
      OTL1_OPEN_EVENTS_WRANGLER_CONFIG: productionConfig,
    },
  });
  const deployments = JSON.parse(
    command(
      join(checkout, "node_modules/.bin/wrangler"),
      ["deployments", "list", "--config", productionConfig, "--json"],
      {
        cwd: checkout,
        timeout: 60_000,
        env: { ...process.env, CLOUDFLARE_API_TOKEN: config.CLOUDFLARE_API_TOKEN },
      },
    ),
  );
  const version = deployments.at(-1)?.versions?.find((item) => item.percentage === 100)?.version_id;
  if (typeof version !== "string" || !/^[0-9a-f-]{36}$/.test(version))
    throw new Error("worker_version_missing");
  const health = JSON.parse(
    command("curl", ["-fsS", config.BUG_DEPLOY_OPEN_EVENTS_HEALTH_URL], {
      timeout: 30_000,
    }),
  );
  if (health.status !== "ok" || health.service !== "open-events" || health.configured !== true)
    throw new Error("open_events_health_failed");
  return { version, health };
}

function deployCoreWorker(checkout, config) {
  for (const name of [
    "CLOUDFLARE_API_TOKEN",
    "OTL1_PRODUCTION_WRANGLER_CONFIG",
    "BUG_DEPLOY_CORE_HEALTH_URL",
  ])
    if (typeof config[name] !== "string" || !config[name].trim())
      throw new Error("core_worker_deployer_unconfigured");
  const productionConfig = resolve(config.OTL1_PRODUCTION_WRANGLER_CONFIG);
  command("bun", ["install", "--frozen-lockfile"], { cwd: checkout, timeout: 180_000 });
  command("bun", ["run", "check"], { cwd: checkout, timeout: 20 * 60_000 });
  command("node", ["scripts/deploy-production-worker.mjs"], {
    cwd: checkout,
    timeout: 10 * 60_000,
    env: {
      ...process.env,
      CLOUDFLARE_API_TOKEN: config.CLOUDFLARE_API_TOKEN,
      OTL1_PRODUCTION_WRANGLER_CONFIG: productionConfig,
    },
  });
  const deployments = JSON.parse(
    command(join(checkout, "node_modules/.bin/wrangler"), [
      "deployments", "list", "--config", productionConfig, "--json",
    ], {
      cwd: checkout,
      timeout: 60_000,
      env: { ...process.env, CLOUDFLARE_API_TOKEN: config.CLOUDFLARE_API_TOKEN },
    }),
  );
  const version = deployments.at(-1)?.versions?.find((item) => item.percentage === 100)?.version_id;
  if (typeof version !== "string" || !/^[0-9a-f-]{36}$/.test(version))
    throw new Error("core_worker_version_missing");
  const health = JSON.parse(command("curl", ["-fsS", config.BUG_DEPLOY_CORE_HEALTH_URL], { timeout: 30_000 }));
  if (health.status !== "ok" || health.configured !== true)
    throw new Error("core_worker_health_failed");
  return { version, health };
}

function deploySite(checkout, config) {
  for (const name of ["CLOUDFLARE_API_TOKEN", "BUG_DEPLOY_SITE_HEALTH_URL"])
    if (typeof config[name] !== "string" || !config[name].trim())
      throw new Error("site_deployer_unconfigured");
  command("node", ["scripts/deploy-production-site.mjs", "--apply"], {
    cwd: checkout,
    timeout: 10 * 60_000,
    env: { ...process.env, CLOUDFLARE_API_TOKEN: config.CLOUDFLARE_API_TOKEN },
  });
  const health = JSON.parse(command("curl", ["-fsS", config.BUG_DEPLOY_SITE_HEALTH_URL], {
    timeout: 30_000,
  }));
  if (health.status !== "ok") throw new Error("site_health_failed");
  return health;
}

export function classificationDigest(policy) {
  return sha256(JSON.stringify({ version: 1, changeClass: policy.changeClass, paths: policy.paths }));
}

export function verifyApprovedPaths(claim, policy, bootstrapMigration) {
  const legacyClaim = claim.changedPaths == null && claim.classificationDigest == null;
  if (legacyClaim && bootstrapMigration && includesMigration(policy.paths, bootstrapMigration)) return;
  if (!Array.isArray(claim.changedPaths) || claim.classificationDigest !== classificationDigest(policy) ||
      JSON.stringify([...claim.changedPaths].sort()) !== JSON.stringify(policy.paths))
    throw new Error("approved_paths_mismatch");
}

export function classifyRunnerDeploymentPaths(paths) {
  const policy = classifyChangePaths(paths);
  return {
    automatic: policy.adapter !== "manual",
    changeClass: policy.changeClass,
    adapter: policy.adapter,
    paths: policy.paths,
  };
}

export function validateDeployerConfig(env) {
  for (const name of [
    "BUG_RUNNER_DATABASE_URL",
    "SLACK_TEAM_ID",
    "CODEX_REPOSITORY_URL",
    "CODEX_BASE_BRANCH",
    "BUG_DEPLOY_CHECKOUT",
    "BUG_DEPLOY_SERVICE",
    "OTL1_MIGRATION_DATABASE_URL",
    "BUG_DEPLOY_SITE_HEALTH_URL",
    "BUG_DEPLOY_APPROVAL_SCOPE_MIGRATION",
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
  migrationConnection(env.OTL1_MIGRATION_DATABASE_URL);
  if (!/^[0-9]{3}$/.test(env.BUG_DEPLOY_APPROVAL_SCOPE_MIGRATION))
    throw new Error("invalid approval scope migration");
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
      body: JSON.stringify({
        query: `SELECT otl.${functionName}($1::jsonb)`,
        params: [JSON.stringify(input)],
      }),
    });
    const body = await response.json();
    if (!response.ok || !Array.isArray(body.rows) || !Array.isArray(body.rows[0]))
      throw new Error(`deployment database call failed: ${functionName}`);
    return body.rows[0][0] === null ? null : JSON.parse(body.rows[0][0]);
  };
}

function deploymentRange(checkout, mergeSha, baseBranch) {
  command("git", ["fetch", "--no-tags", "origin", baseBranch], { cwd: checkout, timeout: 180_000 });
  command("git", ["merge-base", "--is-ancestor", mergeSha, `origin/${baseBranch}`], {
    cwd: checkout,
  });
  const dirty = command("git", ["status", "--porcelain=v1", "--untracked-files=no"], {
    cwd: checkout,
  });
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
    verifyApprovedPaths(claim, policy, config.BUG_DEPLOY_APPROVAL_SCOPE_MIGRATION);
    assertOpenPresentationBoundary(policy.paths, (path) =>
      command("git", ["show", `${mergeSha}:${path}`], { cwd: checkout }),
    );
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
      log("bug.deployer.manual_required", {
        bugId: claim.bugId,
        changeId,
        pathCount: policy.paths.length,
      });
      return { claimed: true, deployed: false, manualRequired: true };
    }
    if (range.current !== mergeSha)
      command("git", ["merge", "--ff-only", mergeSha], { cwd: checkout, timeout: 180_000 });
    const deployedSha = command("git", ["rev-parse", "HEAD"], { cwd: checkout });
    if (deployedSha !== mergeSha) throw new Error("deployed_sha_mismatch");
    const deployedPaths = command("git", ["diff", "--name-only", range.current, deployedSha], {
      cwd: checkout,
    })
      .split("\n")
      .filter(Boolean)
      .sort();
    if (JSON.stringify(deployedPaths) !== JSON.stringify(policy.paths))
      throw new Error("post_merge_paths_mismatch");
    assertOpenPresentationBoundary(deployedPaths, (path) =>
      readFileSync(join(checkout, path), "utf8"),
    );
    let workerVersion;
    let environmentEvidence;
    let observationEvidence;
    if (policy.adapter === "production") {
      const migrations = applyForwardMigrations(
        checkout, policy.paths, config.OTL1_MIGRATION_DATABASE_URL,
      );
      const worker = deployCoreWorker(checkout, config);
      const siteHealth = deploySite(checkout, config);
      workerVersion = worker.version;
      environmentEvidence = {
        host: "genquant", checkout, mergeSha, deployedSha, adapter: policy.adapter,
        migrations, workerVersion,
      };
      observationEvidence = {
        migrationReadback: migrations, coreHealth: worker.health.status,
        siteHealth: siteHealth.status,
      };
    } else if (policy.adapter === "open-events" || policy.adapter === "core-worker") {
      const worker = policy.adapter === "open-events"
        ? deployOpenEvents(checkout, config)
        : deployCoreWorker(checkout, config);
      workerVersion = worker.version;
      environmentEvidence = {
        host: "genquant",
        checkout,
        mergeSha,
        deployedSha,
        adapter: policy.adapter,
        workerVersion,
      };
      observationEvidence = { health: worker.health.status, configured: worker.health.configured };
    } else {
      command("bun", ["qa/genquant-runner-contract.mjs"], { cwd: checkout, timeout: 180_000 });
      command("systemctl", ["--user", "restart", config.BUG_DEPLOY_SERVICE], { timeout: 30_000 });
      const active = command("systemctl", ["--user", "is-active", config.BUG_DEPLOY_SERVICE]);
      if (active !== "active") throw new Error("service_not_active");
      const expectedBranch = `feedback/ot1-${jobId}-`;
      const branchProbe = command(
        "node",
        [
          "--input-type=module",
          "-e",
          `import {buildFixBranch} from './automation/runner/contract.mjs'; console.log(buildFixBranch(${JSON.stringify(claim.publicAlias)},${jobId}))`,
        ],
        { cwd: checkout },
      );
      if (!branchProbe.startsWith(expectedBranch)) throw new Error("branch_probe_failed");
      environmentEvidence = {
        host: "genquant",
        checkout,
        mergeSha,
        deployedSha,
        adapter: "runner",
        service: config.BUG_DEPLOY_SERVICE,
        active,
      };
      observationEvidence = { contract: "genquant-runner-contract", branchProbe };
      workerVersion = randomUUID();
    }
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
      summary:
        policy.adapter === "open-events" || policy.adapter === "core-worker" || policy.adapter === "production"
          ? `승인한 ${policy.adapter === "open-events" ? "Open" : "Core"} 변경 ${mergeSha.slice(0, 7)}을 Worker에 자동 배포하고 health를 확인했습니다.`
          : `GenQuant runner를 ${mergeSha.slice(0, 7)}로 자동 배포하고 계약 테스트·서비스 active·OT1 브랜치 규칙을 확인했습니다.`,
    });
    log("bug.deployer.deployed", { bugId: claim.bugId, changeId, mergeSha, workerVersion });
    return { claimed: true, deployed: true, result };
  } catch (error) {
    const errorCode =
      String(error instanceof Error ? error.message : "deployment_failed")
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
  deployOnce()
    .then((result) => log("bug.deployer.complete", result))
    .catch((error) => {
      log("bug.deployer.failed", { errorType: error instanceof Error ? error.name : "Unknown" });
      process.exitCode = 1;
    });
