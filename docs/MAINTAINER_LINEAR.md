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
- Every Maintainer channel has a value-first channel Canvas: what members gain, how to make a first contribution, examples, and where to ask for help. `maintainers-dev` is a human build studio, not a bot-status archive.
- At 18:00 KST, the Maintainer channel asks for ideas, learning interests, activities and help requests with the same work-proposal entry point. This is distinct from the general member feedback prompt.

## Acceptance

Required: an ordinary operator account clicks real signed Slack buttons in both entry channels; one real Linear issue is created per submission; author assignment, reassignment in both directions, enrollment retries and Core denial are verified. Read back actual channel membership, Linear team/role, shared cards, guide publication and deployment health. Record gaps instead of equating mock checks with live acceptance.

## Current implementation status

- Live channel is `maintainers-retention`, preserving the previous channel ID and history.
- Live workstreams are `maintainers-dev`, `maintainers-design`, and `maintainers-retention`. Their channel Canvases and the pinned retention guide are source-owned and must be published and read back after changes.
- The Core implementation now contains OT1-only issue creation, human DRI assignment and handoff, Guest enrollment with a configured seat cap, signed Linear webhooks, two Slack status surfaces, channel-based Founder approval, retention requests, and a read-only public projection.
- A private OT1L OAuth application exists with Issue/User/Agent Session/Permission Change webhooks. App-actor credentials still need to replace the temporary founder-attributed issue credential before app identity can be called live.
- A new real work item is still required to live-verify the post-deployment DRI selector and two-card Linear synchronization; synthetic block checks do not close that acceptance item.
