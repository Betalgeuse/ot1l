# Maintainer work, optional Linear mirror and retention

Accepted 2026-10-05. Implementation and live acceptance are tracked separately.

## Product contract

- Feedback starts in both freetalk-qna-feedback and Maintainer channels. One submission maps to one OT1L DB work item and two shared Slack cards. Linear is not required.
- Maintainer authors default to themselves as human DRI. Reporter and DRI are distinct. Re-analysis never resets an explicitly changed assignee.
- Slack actor identity and OT1L DB are authoritative for DRI and stage. Linear export UI is hidden by default and appears only when the separate `MAINTAINER_LINEAR_EXPORT_ENABLED` opt-in is enabled. Mirror failures never roll back or block the Slack-native work.
- AI is a delegate, not the human DRI. Existing implementation runner remains the single execution owner until an explicit cutover.
- Founder approval appears in the Maintainer work thread. Core remains Founder-only; Open remains active Maintainer-or-Founder. DM reminders link to that same thread.
- Enrollment is opt-in. Invite and verify every configured Maintainer channel, then activate the role. No external issue-tracker account is required.
- Bot-managed membership may only affect the configured OT1 team. Never change DEV, workspace roles, or expose credentials. Paid invitation capacity is explicitly configured; default denies new seats.
- `maintainers-retention` retains the old welcome workstream channel ID/history. It contains the versioned contributor start guide, questions, Q&A huddle requests and first-contribution OT requests. Public `welcome-start-here` stays separate.
- Personal/security reports are not copied to public cards or Linear.
- Every Maintainer channel has a value-first channel Canvas: what members gain, how to make a first contribution, examples, and where to ask for help. `maintainers-dev` is a human build studio, not a bot-status archive.
- At 18:00 KST, the Maintainer channel asks separately for an improvement, a question/help request, a Q&A huddle, or activity demand. An idempotent catch-up window runs until 22:00 KST. This is distinct from the general member feedback prompt.

## Acceptance

Required: an ordinary operator account clicks real signed Slack buttons in both entry channels; author assignment, reassignment, stage changes and Core denial are verified without a Linear account. Read back actual channel membership, both shared cards, Canvas publication, public board and deployment health. If optional Linear export is enabled, verify it separately and never treat it as the native-work acceptance gate.

## Current implementation status

- Live channel is `maintainers-retention`, preserving the previous channel ID and history.
- Live workstreams are `maintainers-dev`, `maintainers-design`, and `maintainers-retention`. Their channel Canvases and the pinned retention guide are source-owned and must be published and read back after changes.
- The Core implementation contains Slack-native work creation, human DRI assignment and handoff, canonical stages, two Slack status surfaces, channel-based Founder approval, retention requests, a bounded public projection, and optional OT1-only Linear export.
- A private OT1L OAuth application exists with Issue/User/Agent Session/Permission Change webhooks. App-actor credentials still need to replace the temporary founder-attributed issue credential before app identity can be called live.
- A new real work item is still required to live-verify the post-deployment DRI and stage selectors on both shared cards; synthetic block checks do not close that acceptance item.
