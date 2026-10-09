# OT1L coding-agent map

Read `CONTRIBUTING.md` before changing code. This is a public repository, but production authority is not public.

## Route changes by product boundary

- Open product changes: event scheduling UI (excluding event-site dependency/secret/Worker config), public homepage HTML, raster/font assets, Markdown product docs, standalone `design-preview` assets, and ordinary QA. See the executable allowlist, not directory names alone.
- `site/dist/styles.css` and event-schedule assets deploy to BOTH `otl1-site` and `otl1-time`. Site-only assets deploy to `otl1-site`.
- Literal-only Slack display data in `src/slack-presentation/*.ts` is Open only when the executable boundary checker accepts its contents. PO approval may deploy `otl1-onething-garden` for this surface. No executable expressions, imports, getters or computed access.
- Slack interactions, member state, event lifecycle, database, secrets, or security: `src/**`, `migrations/**`, root config and scripts. Target Worker: `otl1-onething-garden`. Treat as Core.
- Membership/PII form scripts, site backend, permission enforcement, DB, deployment infrastructure, build/dependency config and this agent authority map remain protected. Core runtime code receives production capabilities; do not declare arbitrary backend code safe based on filenames alone.
- The executable source of truth is `automation/runner/change-policy.mjs`. Mixed Open surfaces stay Open; any protected path requires Founder. Unknown paths fail closed. Approval class is independent of Worker destination.

## Local workflow

Use Bun and the checked-in lockfile. Run `bun install --frozen-lockfile` and `bun run check`. Add a focused QA assertion for observable behavior. Do not call Slack, Neon, GitHub mutation APIs, or Cloudflare deployment commands from ordinary local tests.

Never copy values from `.dev.vars`, production Wrangler configs, logs, or secret stores into source, documentation, commits, PRs, or prompts. The checked-in Wrangler files contain placeholders and are not production deploy targets.

Contributors push to their own fork and open a PR. Active Product Owners approve an exact verified SHA for Open changes; Founder approval is required for Core changes. Deployment Broker on GenQuant owns merge/deploy credentials and verifies the resulting Worker health. Do not bypass that boundary with a local `wrangler deploy`.

Docs, QA and standalone previews use a repository-only receipt: merge without restarting services or deploying Workers. This does not publish a preview. Draft PRs remain review-only. Version-2 approval digests bind paths, role class and deployment recipe; old pending approvals must be reverified, not silently reused.

## Contribution product contract

PO authority is projected from complete verified membership of configured PO channels (main, workstreams, retention). Never infer PO from sys-alert, arbitrary public channels, display names, or incomplete Slack responses. Preserve explicit revoked states. Reconcile on join/leave signals, cron, and immediately before merge approval; old snapshots must not overwrite newer ones.

The normal route is feedback -> GenQuant Codex -> checks/PR -> PO approval. `직접 만든 PR 검토 요청` is only for an already-created external PR, not a prerequisite for bot work. Preserve opinion-only intake when the desired result is still unknown.

Read `docs/CONTRIBUTION_FLOW.md` for the current Slack-first contribution flow. General feedback is accepted before a coding specification exists. Do not introduce intake interrogation, forced Linear accounts, or PO-to-public feedback projections. Draft PRs are for discussion and must never enter the merge queue. Existing private encryption and secret protection are retained; merely discussing security is not a private incident.

When asked to inspect a contributor's PR, do not mark it ready, approve, merge, or deploy unless explicitly asked. A preview is not a production change. Keep request, review, approval, merge, deploy, and verified completion distinct.
