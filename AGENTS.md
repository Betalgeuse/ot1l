# OT1L coding-agent map

Read `CONTRIBUTING.md` before changing code. This is a public repository, but production authority is not public.

## Route changes by product boundary

- Open event scheduling UI: `event-site/**`, `site/dist/event-schedule.html`, `site/dist/event-schedule.js`, `site/dist/styles.css`, `site/qa/event-schedule.mjs`. Target Worker: `otl1-time`.
- Pure Slack copy and Block Kit rendering: `src/slack-presentation/**` with focused QA in `qa/slack-presentation/**`. These files must not route interactions, bind actors, access member/role/PII state, call databases or APIs, or read configuration. Target Worker: `otl1-onething-garden`, Open approval.
- Slack interactions, member state, event lifecycle, database, secrets, or security: `src/**`, `migrations/**`, root config and scripts. Target Worker: `otl1-onething-garden`. Treat as Core.
- Membership/public site code outside the event-schedule allowlist: Core/manual review.
- The executable source of truth is `automation/runner/change-policy.mjs`. Mixed paths fail closed to Core.

## Local workflow

Use Bun and the checked-in lockfile. Run `bun install --frozen-lockfile` and `bun run check`. Add a focused QA assertion for observable behavior. Do not call Slack, Neon, GitHub mutation APIs, or Cloudflare deployment commands from ordinary local tests.

Never copy values from `.dev.vars`, production Wrangler configs, logs, or secret stores into source, documentation, commits, PRs, or prompts. The checked-in Wrangler files contain placeholders and are not production deploy targets.

Contributors push to their own fork and open a PR. Slack Maintainers approve an exact verified SHA for Open changes; Founder approval is required for Core changes. Deployment Broker on GenQuant owns merge/deploy credentials and verifies the resulting Worker health. Do not bypass that boundary with a local `wrangler deploy`.
