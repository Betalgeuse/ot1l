# OT1L 기여 시작하기

OT1L 저장소는 공개되어 있습니다. 별도 GitHub 초대를 기다리지 않고 자신의 계정으로 fork한 뒤 로컬이나 원하는 AI 개발 도구에서 작업하고 Pull Request를 열 수 있습니다.

## 5분 시작

보통은 Slack의 **피드백·AI 수정 요청**만 사용하면 됩니다. 문제와 원하는 결과를 적으면 GenQuant의 Codex가 수정·검사·PR 생성을 맡습니다. 직접 PR을 연결하지 않고 같은 스레드의 검증 결과를 확인한 뒤 승인합니다. 원하는 결과가 아직 없으면 의견만 접수됩니다.

아래 개발 절차는 **직접 코드를 수정하고 싶은 사람**을 위한 별도 경로입니다. PR(Pull Request)은 GitHub에 올린 코드 수정안을 검토해 달라는 요청입니다. 본인 AI로 로컬에서 개발한 경우도 직접 개발 경로에 해당합니다.

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
| 활성 Product Owner | 제품 변경의 정확한 SHA 검증·승인, Broker를 통한 병합·배포 | 보호 영역 승인, Cloudflare·Slack·DB·SSH 비밀 열람 |
| Founder | Core 변경 승인, 예외 운영 판단 | 검증되지 않은 SHA의 자동 우회 |
| Deployment Broker | 승인된 SHA 병합·배포, 전체 검사와 health 영수증 기록 | 승인 범위 밖 경로 배포, 비밀 공개 |

GitHub collaborator 초대는 Product Owner 활성화의 일부가 아닙니다. 공개 fork/PR을 사용합니다. 일반 회원의 피드백은 PO 작업 공간으로 전달되고, `#po-work`에서 시작한 작업은 공개 피드백 채널로 복제하지 않습니다. PO가 제안하면 본인이 기본 DRI가 되며 작업 카드에서 담당자를 바꿀 수 있습니다.

직접 수정했다면 `#po-work` 안내의 **직접 만든 PR 검토 요청**(이전 이름: PR 연결하기)에 `Betalgeuse/ot1l`을 대상으로 연 PR 주소만 넣습니다. 작업 카드에서 누르면 그 작업이 자동 선택되므로 `BUG-...` 키를 입력하지 않습니다. fork에서 온 PR도 가능합니다. Draft PR은 시안 검토로만 연결하고 병합하지 않습니다. 일반 PR은 기존 봇 작업과의 충돌을 검사한 뒤, Broker가 별도 체크아웃과 비밀정보 없는 격리 환경에서 해당 SHA를 검사해 같은 작업 스레드에 승인 버튼을 보냅니다. 검사에 실패하면 같은 곳에 안내하며 수정 후 다시 연결할 수 있습니다. 자세한 사용자·AI 작업 흐름은 [함께 만드는 흐름](docs/CONTRIBUTION_FLOW.md)을 따릅니다.

지정된 PO 채널(main·workstreams·retention)의 사람 회원은 PO입니다. DB 권한은 채널 구성원의 반영본이며, 가입·탈퇴 이벤트와 정기 점검으로 보정합니다. 병합 승인 직전에도 최신 구성원을 확인합니다. sys-alert만 가입한 사람, 봇, 탈퇴·외부 워크스페이스 계정, 명시적으로 권한이 회수된 계정은 제외합니다. PO 채널에서 모두 나가면 권한이 해제됩니다.

Open 변경은 활성 PO 또는 Founder가, Core 변경은 Founder 본인이 정확한 SHA를 승인합니다. 승인 후 Broker가 병합·배포합니다. 개인 컴퓨터에서 운영 Worker를 직접 배포하지 않습니다.

## 어디까지 PO가 배포할 수 있나요?

- 공개 홈 HTML, 공용 CSS, 이미지·폰트, 이벤트 시간표 UI, 제품 Markdown 문서, 독립 시안, 일반 QA는 PO 승인 대상입니다. 이 경로들을 함께 수정해도 Open입니다.
- `site/dist/styles.css`와 이벤트 시간표 자산은 홈페이지 `otl1-site`와 이벤트 `otl1-time`에 함께 배포합니다. 문서·QA·독립 시안만 수정하면 저장소 반영으로 끝나며 운영 배포나 미리보기 게시를 하지 않습니다.
- `src/slack-presentation/*.ts`는 `export const NAME = { ... } as const;` 형태의 표시 데이터 전용입니다. 문자열은 큰따옴표를 사용합니다. 외부 호출·함수·getter·계산식은 허용하지 않습니다. 이 데이터 변경은 **Core Worker `otl1-onething-garden`도 PO 승인으로 배포**합니다.
- 이벤트 Worker의 설정·비밀·의존성, 가입/개인정보 폼 스크립트·서버, DB, 권한, 배포기·빌드 설정은 Founder 검토 대상입니다. 나머지 Core `src/**`도 현재는 운영 DB·Slack 비밀에 접근할 수 있어 보호합니다. 일반 백엔드까지 PO로 개방하려면 먼저 실행 권한을 분리해야 합니다.
- `automation/runner/**`, `ops/genquant/**`와 승인 정책 자체는 보호 영역입니다. 제품 변경 승인과 배포 권한을 바꾸는 수정이기 때문입니다.

**배포할 Worker 이름이 승인자를 정하지 않습니다.** 보호 경로가 포함됐는지가 기준입니다. 실제 분류와 배포 대상은 [`automation/runner/change-policy.mjs`](automation/runner/change-policy.mjs)가 결정하며 문서보다 코드가 우선합니다. 기존 SHA 승인에는 배포 대상도 묶입니다. 정책이 바뀌면 이전 승인 버튼을 재사용하지 않고 재검증합니다.

운영 설정 예시는 placeholder입니다. `.dev.vars`, production Wrangler config, 토큰, DB URL, SSH key를 커밋하거나 PR·로그·AI 프롬프트에 붙이지 마세요. 로컬 검증은 `bun run check`까지만 수행하며 운영 배포는 Slack 승인과 Broker에 맡깁니다.
