import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertOpenPresentationBoundary, classifyChangePaths } from "./change-policy.mjs";

export function isolatedCheckArgs(worktree, bun, node, install) {
  return ["--die-with-parent", "--new-session", "--unshare-all", ...(install ? ["--share-net"] : []),
    "--clearenv", "--setenv", "HOME", "/tmp/home", "--setenv", "PATH", "/tools:/usr/bin:/bin",
    "--ro-bind", "/usr", "/usr", "--ro-bind", "/lib", "/lib", "--ro-bind", "/lib64", "/lib64",
    "--symlink", "usr/bin", "/bin", "--dir", "/tools", "--ro-bind", bun, "/tools/bun",
    "--ro-bind", node, "/tools/node", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
    "--dir", "/tmp/home", "--dir", "/etc", "--ro-bind", "/etc/resolv.conf", "/etc/resolv.conf",
    "--ro-bind", "/etc/ssl", "/etc/ssl", "--bind", worktree, "/work", "--chdir", "/work",
    "--", "/tools/bun", ...(install ? ["install", "--frozen-lockfile"] : ["run", "check"])];
}

export function verifyBoundPullRequest(repository, repositorySlug, binding, runCommand) {
  if (repositorySlug !== "Betalgeuse/ot1l" || binding.repository !== repositorySlug)
    throw new Error("bound pull repository mismatch");
  const view = () => JSON.parse(runCommand("gh", ["pr", "view", String(binding.pr_number),
    "--repo", repositorySlug, "--json", "state,baseRefName,headRefOid,files,isDraft"]));
  const verify = (pr) => {
    const paths = pr.files?.map(({ path }) => path).sort();
    if (pr.state !== "OPEN" || pr.isDraft === true || pr.baseRefName !== "main" || pr.headRefOid !== binding.head_sha ||
      !Array.isArray(paths) || JSON.stringify(paths) !== JSON.stringify([...binding.changed_paths].sort()))
      throw new Error("bound pull identity or paths changed");
    return paths;
  };
  const paths = verify(view());
  runCommand("git", ["-C", repository, "fetch", "--no-tags", "origin", `pull/${binding.pr_number}/head`]);
  if (runCommand("git", ["-C", repository, "rev-parse", "FETCH_HEAD"]) !== binding.head_sha)
    throw new Error("bound pull fetched head changed");
  assertOpenPresentationBoundary(paths, path => runCommand("git", ["-C", repository, "show", `${binding.head_sha}:${path}`]));
  verifyCandidateCheckout(repository, binding.head_sha, runCommand);
  verify(view());
  return classifyChangePaths(paths);
}

export function verifyCandidateCheckout(repository, headSha, runCommand) {
  if (!/^[a-f0-9]{40}$/.test(headSha)) throw new Error("invalid candidate SHA");
  const directory = mkdtempSync(join(tmpdir(), "otl1-bound-pull-"));
  const worktree = join(directory, "checkout");
  try {
    runCommand("git", ["-C", repository, "worktree", "add", "--detach", worktree, headSha]);
    // Candidate code never inherits the broker environment, home, SSH agent,
    // credential files, or access to other host repositories.
    const bun = realpathSync(runCommand("which", ["bun"]));
    const node = realpathSync(runCommand("which", ["node"]));
    runCommand("bwrap", isolatedCheckArgs(worktree, bun, node, true), { timeout: 180_000 });
    runCommand("bwrap", isolatedCheckArgs(worktree, bun, node, false), { timeout: 20 * 60_000 });

  } finally {
    try { runCommand("git", ["-C", repository, "worktree", "remove", "--force", worktree]); }
    finally { rmSync(directory, { recursive: true, force: true }); }
  }
}
