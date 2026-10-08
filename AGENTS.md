# OT1L coding-agent map

Read `CONTRIBUTING.md` before changing code. This is a public repository, but production authority is not public.

## Route changes by product boundary

- Open event scheduling UI: `event-site/**`, `site/dist/event-schedule.html`, `site/dist/event-schedule.js`, `site/dist/styles.css`, `site/qa/event-schedule.mjs`. Target Worker: `otl1-time`.
- Dependency-free Slack display files in `src/slack-presentation/*.ts` are Open only when the executable boundary checker accepts their contents.
- Slack interactions, member state, event lifecycle, database, secrets, or security: `src/**`, `migrations/**`, root config and scripts. Target Worker: `otl1-onething-garden`. Treat as Core.
- Membership/public site code outside the event-schedule allowlist: Core/manual review.
- The executable source of truth is `automation/runner/change-policy.mjs`. Mixed paths fail closed to Core.

## Local workflow

Use Bun and the checked-in lockfile. Run `bun install --frozen-lockfile` and `bun run check`. Add a focused QA assertion for observable behavior. Do not call Slack, Neon, GitHub mutation APIs, or Cloudflare deployment commands from ordinary local tests.

Never copy values from `.dev.vars`, production Wrangler configs, logs, or secret stores into source, documentation, commits, PRs, or prompts. The checked-in Wrangler files contain placeholders and are not production deploy targets.

Contributors push to their own fork and open a PR. Active Product Owners approve an exact verified SHA for Open changes; Founder approval is required for Core changes. Deployment Broker on GenQuant owns merge/deploy credentials and verifies the resulting Worker health. Do not bypass that boundary with a local `wrangler deploy`.

## Contribution product contract

Read `docs/CONTRIBUTION_FLOW.md` for the current Slack-first contribution flow. General feedback is accepted before a coding specification exists. Do not introduce intake interrogation, forced Linear accounts, or PO-to-public feedback projections. Draft PRs are for discussion and must never enter the merge queue. Existing private encryption and secret protection are retained; merely discussing security is not a private incident.

When asked to inspect a contributor's PR, do not mark it ready, approve, merge, or deploy unless explicitly asked. A preview is not a production change. Keep request, review, approval, merge, deploy, and verified completion distinct.
