# 운영 랜딩페이지 디자인 출처

2026-10-09: 윤수님의 PR #109, `113404901bf8288ae91745389de84924ddba0140`의 네 페이지 시안을 운영 홈페이지에 통합했습니다. 검정 표지·붉은 강조색·흰 내용 페이지, 고정 헤더/하단 페이저, SET/DO/REVIEW 원형 메뉴와 상세 dialog, 나란히 걷는 예시 레이아웃을 보존합니다. 원본 Draft PR 자체를 병합하지 않고 운영 연결을 별도로 구현합니다.

랜딩은 `landing.css`와 `landing.js`를 사용하며 이벤트·신청·영수증 페이지의 공용 CSS와 분리합니다. 초대 URL에는 동일 템플릿의 첫 페이지로 실제 초대장이 들어갑니다. 참여 문의는 서버 feature flag를 따르며 시안용 가짜 버튼을 사용하지 않습니다. 기존 소속 로고, canonical URL, 보안 헤더와 초대·개인정보 처리 흐름을 보존합니다. JavaScript가 없으면 내용은 세로로 읽을 수 있습니다.

## 공용 화면과 이전 랜딩의 참고 기록

아래 항목은 공용 CSS 및 이전 랜딩의 기록입니다. 현재 랜딩의 레이아웃·색상 기준은 위의 윤수님 시안과 landing.css이며 아래 내용으로 덮어쓰지 않습니다.

# OTL1 site design system

## 0. Research log

- Reference packet: studied the supplied editorial cadence: sticky navigation, numbered labels, thin rules, large chapters, a rail-and-reading-column rhythm, and its mobile collapse. It is a grammar reference only; no source copy, palette, names, typeface, copy, artwork, or layout asset is reused.
- Product source: `docs/PRODUCT_PRINCIPLES.md` anchors the story in a concrete daily practice, honest peer support, and a return path without guilt.
- Direction: **a field notebook becoming a garden.** Deep forest paper and warm ink make the site feel like a durable nighttime record; a restrained leaf-green field signals practice becoming visible. The memorable moment is the four square cells filling from a 10:00 intention into an 18:00 reflection.

## 0.1 Daily-thread redesign plan

The prior preview swapped one generic bot card among three states. It did not show the actual shape of the daily practice and incorrectly described the morning goal and evening review as one Slack thread. Preserve the paper, ink, leaf field, thin rules, and square controls; replace only that preview with two short, clearly separated fictional `#daily-scrum` conversations: a 10:00 goal root and an 18:00 review root.

The preview uses one native replay button. A user-triggered replay reveals already-reserved rows in their reading order with only opacity and an upward transform; it never sends a Slack request or fabricates an ongoing chat. JavaScript-disabled and reduced-motion presentations show the complete example and its final single Day 1 completion cell immediately. The referral page borrows a compact two-thread explanation before its existing application form so an invitee can understand the routine without duplicating the full preview.

## 0.2 ONE THING 1 LINE brand story

The public name is always `ONE THING 1 LINE`; “한 문장” describes the input format and never substitutes for the product name. The existing OT1L bot avatar anchors the navigation wordmark. The homepage hero pairs one oversized, single-line brand lockup with the approved black Korean edition of 『원씽』, linked to its product source with a visible no-sponsorship statement.

The visitor path is deliberately short: promise, daily rhythm, trusted peers, real board preview, invitation. `SET ONE THING`, `DO ONE THING`, and `REVIEW ONE THING` form the instructional spine. Code-native clocks identify 10:00 and 18:00. The peer chapter leads with focus, accountable execution, and learning from capable peers; custom emoji remain atmospheric support behind clearly fictional role examples. The referral route replaces only the top promise with the inviter context, then reuses rhythm, peers, and preview before the unchanged application contract.

## 1. Tokens

| Role | Token | Value |
| --- | --- | --- |
| Paper | `--paper` | `#101713` |
| Ink | `--ink` | `#f3f1e8` |
| Night | `--night` | `#080d0b` |
| Mist | `--mist` | `#b9c3ba` |
| Leaf | `--leaf` | `#294835` |
| Rule | `--rule` | `rgba(243, 241, 232, .26)` |
| Return field | `--return-field` | `#1c2922` |
| Preview paper | `--paper-preview` | `#17211c` |
| Focus ink | `--focus-ink` | `#9bcf82` |
| Muted UI ink | `--ink-muted` / `--ink-subtle` | `#b8c2b9` / `#9eaaa1` |
| Inverse rule | `--rule-inverse` / `--rule-inverse-strong` | paper at 40% / 50% |
| Sans | `--sans` | system Korean UI stack |
| Display | `--display` | Georgia and Korean serif fallbacks |

The spacing scale is `--space-8`, `--space-16`, `--space-24`, `--space-32`, `--space-48`, `--space-72`, and `--space-112`. Named component increments keep the smaller optical gaps and editorial geometry inspectable without introducing literal values into rules. Every surface is square and flat; rules describe boundaries instead of cards or shadows.

## 2. Type and layout

Display type uses `--display-hero` and `--display-section`, a tight serif stack at 56–88px desktop and 38–54px mobile. Interface and reading copy use `--type-11` through `--type-21` in the system Korean UI stack; `--type-caption`, `--type-label`, `--type-body`, and `--type-reading` alias the recurring role sizes. A maximum 1240px grid holds 12 columns; editorial chapters use a 3-column rail and 7-column reading block, then become one column under 760px.

## 3. Primitives

- `site-nav`: sticky semantic navigation with a native mobile disclosure button.
- `chapter-label`: topic, two-digit index, and one-pixel divider.
- `editorial`: rail, reading column, and an original inline SVG process illustration.
- `garden-cell`: a visual progress square with distinct fill and outline states; the site uses it as a decorative explanation of the product record, rather than an interactive control.
- `collective-board`: a single, responsive production-rendered PNG for the fictional four-day example. `site/qa/generate-example-board.mts` calls `renderBoard` with `DEFAULT_PALETTE`, so the visible DAY labels, completion checks, today outline, and future cell are the same board language sent to Slack.
- `daily-thread`: a square, source-labeled fictional `#daily-scrum` root conversation. A morning goal and evening review are separate thread primitives, never a single simulated Slack thread.
- `daily-row`: a reserved-height member, bot, or peer row that enters only through opacity and an upward transform after a user asks to replay the example.
- `brand-lockup`: a responsive one-line `ONE THING 1 LINE` display that never wraps on supported viewports.
- `book-card`: the locally served Korean cover, source link, bibliographic line, and no-sponsorship statement.
- `stage-marker`: a code-native clock or execution icon paired with a stage label and accessible name.
- `peer-examples`: three explicitly fictional role examples that connect a concrete ONE THING to execution and learning.

## 4. Motion and accessibility

Intersection observers reveal sections only after JavaScript has attached the motion class, so blocked JavaScript leaves all content visible. They do not run a continuous decorative animation. `prefers-reduced-motion: reduce` removes transforms, transitions, smooth scrolling, and animation while preserving final content states. Keyboard focus uses a high-contrast outline; diagrams have `role="img"` labels and decorative marks are hidden.

## 5. Responsive rules and accepted debt

The nav collapses at 760px, chapter typography scales through `clamp()`, the brand lockup remains on one visual line, and text wraps naturally without horizontal scrolling at 320px. The book moves below the promise on narrow screens without changing its aspect ratio. `index.html` is the only source for the homepage and member referral experience. The site Worker renders a referral by inserting exactly one invitation section into the homepage's `__REFERRAL_SLOT__`; every later homepage section, asset, and interaction stays shared. The invitation section links directly to the validated shared Slack invite route and offers the member-specific copy text. The signed form endpoint remains available for compatibility, but the current referral page collects no email or personal data before Slack. The Worker resolves opaque links through the core binding.

## 6. Reactions and member invitation

The homepage keeps the notebook's deep forest paper, warm ink, leaf field, thin rules, and square edges. New reaction and preview chapters use the same primitives. The reaction imagery is an absolute, transparent layer behind the leaf chapter copy. It contributes no layout height, border, fill, or pointer target; each sprite fades to zero before reaching the section edge. A transparent mask quiets motion under the copy, preserving contrast without a backing panel. Eight screened Slack custom assets with verified transparent alpha are shipped locally. The opaque blue completion tile and white-backed cat are excluded. GIFs appear only in the active rise layer. Static, real PNG assets make the six-image reduced-motion and no-script composition. No member photo enters the site.

The member chapter places nine approved affiliation marks directly below its promise. Two identical groups create a continuous leftward loop; the second group is hidden from assistive technology, hover pauses the movement, and reduced-motion users receive one horizontally scrollable static group. The local assets come from each organization's official site: SNU CALS, SNU College of Engineering, SNU Business School, Baemin, POSTECH UI Guide, KAIST UI, Visang Education, Samsung Brand Identity, and Chonnam National University Medical School. Transparent padding is cropped without changing the marks themselves.

The Slack join controls use the unmodified 32px Slack mark served by Slack's official asset host (`a.slack-edge.com`, SHA-256 `d22bb780d085d74375c71f399059d8ac4410cf8e813ce6b59f7a4639b270e935`) and store it locally as `assets/slack-mark.png`. Do not redraw the mark from approximate colored paths.

The canonical public origin is `https://ot1l.hyuk.me`, matching the brand token `OT1L` exactly. `https://otl1.hyuk.me` is a legacy transposition and must only appear in the explicit 308 redirect path and its negative-control test. Share copy, canonical metadata, social images, referral links, Turnstile hostname checks, and the Core `PUBLIC_APPLICATION_ORIGIN` all use the canonical origin.

The rise layer moves only by `transform` and `opacity`, with a bounded random negative start delay. Visibility and document state pause the layer when it cannot be seen. The preview below it is a locally simulated pair of `#daily-scrum` root conversations. One native replay button reveals its fixed rows in reading order, retains focus, and only updates a polite status region; it performs no network write. `Escape` cancels the remaining timer without hiding rows already shown. Reduced motion and no-JavaScript show the whole fictional example immediately.

The invitation chapter uses the owner's exact spoken invitation and depicts a member-specific `/r/` link without making a shared link. The interest callout describes an optional private inquiry. The Worker renders its square, outlined link only when `PUBLIC_INTEREST_ENABLED=true`; otherwise it remains a non-interactive readiness label. The dedicated `/interest` page reuses the referral page's paper-and-leaf editorial grid, labelled controls, focus treatment, and mobile collapse. The closing chapter uses the one fictional Day 1–Day 4 production board PNG on both homepage and referral page. Its first three cells are complete and checked; Day 4 remains the renderer's future empty cell.

New homepage primitives: a transparent `reaction-stage` layer, `daily-thread`/`daily-row`, `daily-garden`, `invitation-note`, and `collective-board`. They preserve the existing 1240px container and collapse into reading order below 760px. The preview paper tint `#17211c` keeps the board image readable without replacing it with CSS illustration. Message rows use a 180ms opacity/transform transition; reduced motion removes it.
