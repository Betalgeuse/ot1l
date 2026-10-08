# OT1L 기여 시작하기

OT1L 저장소는 공개되어 있습니다. 별도 GitHub 초대를 기다리지 않고 자신의 계정으로 fork한 뒤 로컬이나 원하는 AI 개발 도구에서 작업하고 Pull Request를 열 수 있습니다.

## 5분 시작

```sh
git clone https://github.com/YOUR_GITHUB_ID/ot1l.git
cd ot1l
git remote add upstream https://github.com/Betalgeuse/ot1l.git
git switch -c feature/short-description
bun install --frozen-lockfile
bun run check
git push -u origin feature/short-description
```

PR의 base는 `Betalgeuse/ot1l:main`으로 지정하고, 무엇을 바꿨는지와 `bun run check` 결과를 적습니다. 운영 피드백에서 시작한 작업이면 `BUG-...` 키와 Slack 스레드 링크도 함께 적습니다.

## 권한과 배포

| 역할 | 할 수 있는 일 | 할 수 없는 일 |
| --- | --- | --- |
| 공개 Contributor | fork, 로컬 개발, 자신의 fork에 push, PR 제출 | upstream 직접 push, 운영 비밀 접근, 운영 배포 |
| Slack Maintainer | 위 작업과 Open 변경의 정확한 SHA 검증·승인 | Core 승인, Cloudflare·Slack·DB·SSH 비밀 열람 |
| Founder | Core 변경 승인, 예외 운영 판단 | 검증되지 않은 SHA의 자동 우회 |
| Deployment Broker | 승인된 SHA 병합·배포, 전체 검사와 health 영수증 기록 | 승인 범위 밖 경로 배포, 비밀 공개 |

GitHub collaborator 초대는 Product Owner 활성화의 일부가 아닙니다. 공개 fork/PR을 사용합니다. 일반 회원의 피드백은 PO 작업 공간으로 전달되고, `#po-work`에서 시작한 작업은 공개 피드백 채널로 복제하지 않습니다. PO가 제안하면 본인이 기본 DRI가 되며 작업 카드에서 담당자를 바꿀 수 있습니다.

직접 수정했다면 `#po-work` 안내의 **PR 연결하기**에 `Betalgeuse/ot1l`을 대상으로 연 PR 주소만 넣습니다. 작업 카드에서 누르면 그 작업이 자동 선택되므로 `BUG-...` 키를 입력하지 않습니다. fork에서 온 PR도 가능합니다. Draft PR은 시안 검토로만 연결하고 병합하지 않습니다. 일반 PR은 기존 봇 작업과의 충돌을 검사한 뒤, Broker가 별도 체크아웃과 비밀정보 없는 격리 환경에서 해당 SHA를 검사해 같은 작업 스레드에 승인 버튼을 보냅니다. 검사에 실패하면 같은 곳에 안내하며 수정 후 다시 연결할 수 있습니다. 자세한 사용자·AI 작업 흐름은 [함께 만드는 흐름](docs/CONTRIBUTION_FLOW.md)을 따릅니다.

Open 변경은 활성 PO 또는 Founder가, Core 변경은 Founder 본인이 정확한 SHA를 승인합니다. 승인 후 Broker가 병합·배포합니다. 개인 컴퓨터에서 운영 Worker를 직접 배포하지 않습니다.

## 어느 Worker를 고쳐야 하나요?

- `event-site/**`, `site/dist/event-schedule.*`, `site/qa/event-schedule.mjs`: 공개 이벤트 시간표 Worker `otl1-time`. 비밀이 없는 Open 변경입니다.
- `src/slack-presentation/*.ts`: 비밀정보와 외부 호출이 없는 Slack 표시 전용 코드. 실행 가능한 경계 검사를 통과해야 Open입니다.
- 그 외 `src/**`, `migrations/**`, 루트 `wrangler.jsonc`: Slack 상호작용, 회원 상태, DB, Core Worker `otl1-onething-garden`. Founder 승인이 필요한 Core 변경입니다.
- `site/**`의 이벤트 시간표 외 경로: 가입·공개 사이트 영역입니다. 현재 자동 Open 배포 대상이 아닙니다.
- `automation/runner/**`, `ops/genquant/**`: 배포·수정 브로커 자체입니다. Core로 취급합니다.

경로가 섞이면 더 강한 쪽인 Core로 분류됩니다. 실제 분류 기준은 [`automation/runner/change-policy.mjs`](automation/runner/change-policy.mjs)이며 문서보다 코드가 우선합니다.

운영 설정 예시는 placeholder입니다. `.dev.vars`, production Wrangler config, 토큰, DB URL, SSH key를 커밋하거나 PR·로그·AI 프롬프트에 붙이지 마세요. 로컬 검증은 `bun run check`까지만 수행하며 운영 배포는 Slack 승인과 Broker에 맡깁니다.
