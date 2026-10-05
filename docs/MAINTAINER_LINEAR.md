# Maintainer, Linear and retention

Accepted 2026-10-05. Implementation and live acceptance are tracked separately.

## Product contract

- Feedback starts in both freetalk-qna-feedback and Maintainer channels. One submission maps to one Linear OT1 issue and two shared Slack cards.
- Maintainer authors default to themselves as human DRI. Reporter and DRI are distinct. Re-analysis never resets an explicitly changed assignee.
- Linear Assignee is authoritative after issue creation. Slack assignment updates Linear and reads the result back; Linear changes refresh shared cards. Pending or failed writes are not reported as success.
- AI is a delegate, not the human DRI. Existing implementation runner remains the single execution owner until an explicit cutover.
- Founder approval appears in the Maintainer work thread. Core remains Founder-only; Open remains active Maintainer-or-Founder. DM reminders link to that same thread.
- Enrollment is opt-in. Invite and verify every configured Maintainer channel, then activate the role. Linear Guest enrollment is separate and visibly pending until accepted.
- Bot-managed membership may only affect the configured OT1 team. Never change DEV, workspace roles, or expose credentials. Paid invitation capacity is explicitly configured; default denies new seats.
- `maintainers-retention` retains the old welcome workstream channel ID/history. It contains the versioned contributor start guide, questions, Q&A huddle requests and first-contribution OT requests. Public `welcome-start-here` stays separate.
- Personal/security reports are not copied to public cards or Linear.

## Acceptance

Required: an ordinary operator account clicks real signed Slack buttons in both entry channels; one real Linear issue is created per submission; author assignment, reassignment in both directions, enrollment retries and Core denial are verified. Read back actual channel membership, Linear team/role, shared cards, guide publication and deployment health. Record gaps instead of equating mock checks with live acceptance.

## Current implementation status

- Live channel is `maintainers-retention`, preserving the previous channel ID and history.
- The Core implementation now contains OT1-only issue creation, human DRI assignment and handoff, Guest enrollment with a configured seat cap, signed Linear webhooks, two Slack status surfaces, channel-based Founder approval, retention requests, and a read-only public projection.
- A private OT1L OAuth application exists with Issue/User/Agent Session/Permission Change webhooks. App-actor credentials still need to replace the temporary founder-attributed issue credential before app identity can be called live.
- Migration, deployment, Slack/Linear connection, guide publication, real operator/browser acceptance and website deployment remain required before the feature is called complete.
