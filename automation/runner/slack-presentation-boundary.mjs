import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

const PRESENTATION_PATH = /^src\/slack-presentation\/[a-z0-9-]+[.]ts$/;
const FORBIDDEN_SOURCE = [
  [/^\s*import\s/m, "import"],
  [/\b(?:process|globalThis)\s*[.]\s*env\b/, "environment"],
  [/\bfetch\s*\(/, "fetch"],
  [/\b(?:DATABASE_URL|SLACK_[A-Z_]*TOKEN|SLACK_SIGNING_SECRET)\b/, "secret"],
  [/\b(?:NeonStore|CommunityStore|queryJson|execute|postgres|migration)\b/i, "database"],
  [/\b(?:callSlack|WebClient|chat[.]|conversations[.]|users[.])/, "API"],
  [/\b(?:action_id|callback_id|ownerId|actorId|userId|teamId|channelId)\b/, "routing"],
  [/\b(?:is_admin|is_owner|maintainerStatus|member|role)\b/i, "member_or_role"],
  [/\b(?:email|real_name|display_name|phone)\b/i, "PII"],
  [/\b(?:Deployment Broker|deployer|wrangler|cloudflare)\b/i, "Broker"],
];

export function slackPresentationPath(path) {
  return PRESENTATION_PATH.test(path);
}

export function verifySlackPresentationBoundary(checkout, paths) {
  const root = resolve(checkout);
  const presentationPaths = [...new Set(paths)].filter(slackPresentationPath).sort();
  for (const path of presentationPaths) {
    const absolute = resolve(root, path);
    if (!absolute.startsWith(`${root}${sep}`)) throw new Error("slack_presentation_path_escape");
    const source = readFileSync(absolute, "utf8");
    for (const [pattern, boundary] of FORBIDDEN_SOURCE)
      if (pattern.test(source))
        throw new Error(`slack_presentation_forbidden_${boundary.toLowerCase()}`);
  }
  return presentationPaths;
}
