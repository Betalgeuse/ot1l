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

GitHub collaborator 초대는 Maintainer 활성화의 일부가 아닙니다. GitHub 권한과 Slack 역할을 억지로 묶지 않고 공개 fork/PR을 사용합니다. 현재 자동 병합·배포 큐는 OT1L 피드백 흐름이 만든 PR에 연결됩니다. 피드백은 일반 피드백 채널과 `#maintainers` 양쪽에서 시작할 수 있고, 한 Linear 이슈와 두 Slack 상태 카드로 연결됩니다. Maintainer가 제안하면 본인이 기본 DRI가 되며 작업 카드에서 다른 Maintainer에게 넘길 수 있습니다. Open 변경은 활성 Maintainer 또는 Founder가 승인하고 Core 변경은 `#maintainers`에 보이는 동일한 버튼을 Founder 본인만 누를 수 있습니다. 직접 만든 PR을 큐에 넣는 셀프서비스 버튼은 아직 없습니다. 직접 만든 PR은 `#maintainers`에 링크해 Founder가 피드백 항목과 승인 SHA에 연결한 뒤 같은 Broker 경로로 반영합니다. 개인 컴퓨터에서 운영 Worker를 직접 배포하지 않습니다.

## 어느 Worker를 고쳐야 하나요?

- `event-site/**`, `site/dist/event-schedule.*`, `site/qa/event-schedule.mjs`: 공개 이벤트 시간표 Worker `otl1-time`. 비밀이 없는 Open 변경입니다.
- `src/slack-presentation/**`, `qa/slack-presentation/**`: Slack 문구·레이아웃·버튼 색처럼 동작 권한을 바꾸지 않는 순수 표시 코드와 전용 QA입니다. 활성 Product Owner가 정확한 SHA를 승인할 수 있는 Open 변경입니다.
- `src/**`, `migrations/**`, 루트 `wrangler.jsonc`: Slack, 회원 상태, DB, Core Worker `otl1-onething-garden`. Founder 승인이 필요한 Core 변경입니다.
- `site/**`의 이벤트 시간표 외 경로: 가입·공개 사이트 영역입니다. 현재 자동 Open 배포 대상이 아닙니다.
- `automation/runner/**`, `ops/genquant/**`: 배포·수정 브로커 자체입니다. Core로 취급합니다.

interaction routing·actor binding·회원/역할 권한·PII·DB/migration·secret·Worker config·Broker 경로는 계속 Core입니다. Open 경로와 다른 경로가 섞이면 더 강한 쪽인 Core로 분류됩니다. 실제 분류 기준은 [`automation/runner/change-policy.mjs`](automation/runner/change-policy.mjs)이며 문서보다 코드가 우선합니다.

운영 설정 예시는 placeholder입니다. `.dev.vars`, production Wrangler config, 토큰, DB URL, SSH key를 커밋하거나 PR·로그·AI 프롬프트에 붙이지 마세요. 로컬 검증은 `bun run check`까지만 수행하며 운영 배포는 Slack 승인과 Broker에 맡깁니다.
