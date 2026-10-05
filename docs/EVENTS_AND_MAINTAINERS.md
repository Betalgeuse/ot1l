# Townhall 이벤트와 Maintainer 운영

## 회원용 이벤트 사용법

1. `#townhall`에서 날짜가 정해졌다면 **일정 정해서 열기**, 아직 모른다면 **시간 같이 정하기**를 누릅니다. 바로 주최하기 전 관심을 보고 싶다면 **수요 먼저 확인하기**, 다른 회원이 열어주길 원하면 **누가 좀 열어주세요**를 누릅니다.
2. 주최자 이름은 입력하지 않습니다. Slack에서 누른 회원을 `<@mention>님이 이벤트를 열었어요`로 표시합니다.
3. 활동과 장소 또는 접속 방법을 적습니다. 시간을 아직 모르면 비워 둔 채 먼저 모집할 수 있습니다.
4. 고정 일정은 Slack에서 **참가할게요** 한 번으로 끝납니다.
5. 시간 같이 정하기는 주간 달력에서 “이 시간으로 확정되면 참가”할 칸을 복수 선택합니다.
6. 주최자가 한 칸을 확정하면 그 칸을 선택한 회원은 자동 참가됩니다. 정기 모임이면 매주 또는 격주와 2–24회 회차를 선택합니다.
7. 주최자는 이벤트를 여는 즉시 참가 확정 1명으로 포함됩니다. **최소 성사 인원**은 모임이 열리는 기준이며 정원이 아닙니다. **최대 인원**을 따로 적고, 제한이 없으면 비워 두어 무제한으로 설정합니다. 최대 인원이 차면 추가 신청은 대기자로 기록합니다.

Slack 리액션은 자유로운 반응이며 제품 상태로 집계하지 않습니다. 모집 마감에 최소 인원이 부족하면 취소 유예로 바뀌고, 설정한 유예가 끝날 때까지도 미달이면 자동 취소·보관합니다.

수요 카드는 관심 숫자를 따로 세지 않습니다. 리액션은 관심 표현에, 스레드는 가능한 시간·장소와 아이디어에 사용합니다. **내가 주최할래요!**는 내용을 채운 시간 조율 이벤트를 열고, 이벤트가 하나 생긴 뒤에도 **나도 주최하기**로 같은 수요에서 추가 이벤트를 만들 수 있습니다. 제안자는 수요를 수정하거나 마감할 수 있습니다.

현재 Slack의 **이벤트 수정**에서 활동·장소·최소 성사 인원·최대 인원과 확정 일정을 바꿀 수 있습니다. 시간 후보 범위나 정기 회차를 크게 바꾸는 경우 웹 시간표에서 다시 설정하고 최종 시간을 재확정합니다.

## Maintainer와 승인 경계

- 모든 회원은 welcome 또는 피드백 카드의 **Maintainer 되기**로 역할을 스스로 활성화할 수 있습니다. 버튼을 누른 본인만 DB 역할이 활성화되고 `#maintainers`, 세 작업 채널과 공개 `#sys-alert`에 초대됩니다.
- 저장소는 공개입니다. GitHub collaborator 초대나 upstream push 권한을 주지 않고, 각자 fork에서 개발·push한 뒤 PR을 엽니다. 시작 절차는 [기여 시작하기](../CONTRIBUTING.md)를 따릅니다.
- Open 변경은 활성 Maintainer 한 명이 검증 결과와 정확한 head SHA를 Slack에서 승인하면 Deployment Broker가 병합과 배포를 이어서 수행합니다. Maintainer 개인 컴퓨터에서 운영 Worker를 배포하지 않습니다.
- 피드백은 일반 피드백 채널과 `#maintainers`에서 시작할 수 있습니다. 한 Linear 이슈를 원본으로 두고 두 Slack 카드의 단계와 DRI를 갱신합니다. Maintainer 작성자는 기본 DRI이며 드롭다운에서 다른 활성 Maintainer에게 넘길 수 있습니다.
- 수정안과 검증이 준비되면 Open과 Core 승인 버튼 모두 같은 `#maintainers` 작업 스레드에 나타납니다. Open은 활성 Maintainer 또는 Founder, Core는 Founder 본인만 승인할 수 있고 DM은 작업 스레드 링크만 알립니다.
- Linear 연결은 DRI를 맡을 Maintainer가 명시적으로 요청할 때 `ot1l` 전용 Guest로 진행합니다. `DEV` 팀, 워크스페이스 역할과 운영 비밀에는 접근시키지 않습니다. OT1L 앱은 무료 Delegate이며 사람 DRI를 대신하지 않습니다.
- `#maintainers-retention`의 버전 안내에서 질문, Q&A 허들과 첫 기여 OT를 요청합니다. 허들은 요청 즉시 자동 시작하지 않고 담당자가 정해진 뒤 같은 채널과 스레드에서 엽니다.
- 웹의 **함께 만드는 중**은 Plane의 낮은 밀도 보드 방식을 참고한 선택 화면입니다. Linear나 웹을 확인하지 않아도 일반 회원은 원래 Slack 스레드에서 담당자와 단계를 볼 수 있습니다.
- 이벤트 공개 화면은 별도 `otl1-time` Worker에서 실행합니다. 이 Worker에는 Slack token, DB URL, SSH key가 없고 이벤트 전용 Core 서명키만 있습니다.
- 가입, 개인정보, 보안, Slack 처리와 Core Worker 코드 변경은 Founder 승인 뒤에만 병합·배포합니다. DB migration과 일반 홈페이지처럼 별도 순서가 필요한 변경은 Founder 승인 뒤에도 자동 배포하지 않고 운영 절차로 넘깁니다.
- 경로가 섞였거나 분류 digest 또는 head SHA가 바뀌면 승인은 무효가 되며 다시 검증해야 합니다.
- Deployment Broker는 승인된 SHA만 fast-forward하고 전체 검사, 배포, health 확인 뒤 영수증을 남깁니다. Maintainer에게 GenQuant SSH나 Cloudflare token을 전달하지 않습니다.
- 공개 `#sys-alert`에는 GitHub·홈페이지·Worker의 배포 실패와 장애 요약만 게시합니다. 요청 본문, 토큰, 쿠키, 이메일, IP, 원본 stack trace와 DB 주소는 게시하지 않습니다.

현재 Broker의 자동 큐는 OT1L 피드백 흐름에서 만든 PR을 기준으로 합니다. Maintainer가 자신의 fork에서 만든 PR을 자동 큐에 등록하는 버튼은 아직 없습니다. 직접 만든 PR은 `#maintainers`에 링크해 Founder가 피드백 항목과 정확한 SHA에 연결한 뒤 같은 승인 경계로 반영합니다. 단순히 public PR이 열렸다는 이유만으로 병합하거나 배포하지 않습니다.

Open 경로의 기준은 `automation/runner/change-policy.mjs`이며 fail-closed입니다. 현재는 `event-site/**`와 이벤트 시간표의 정적 자산·QA만 Open입니다. `src/**`, `migrations/**`, 가입·개인정보·보안 경로는 Core입니다. 경로가 섞이면 Core로 분류합니다.

## 운영 점검

- DB: 이벤트용 `067`–`076`, Maintainer 재클릭 안전성용 `078`, Linear 작업 연결용 `083` migration이 순서대로 적용되어야 합니다.
- Core secrets: `EVENT_SIGNING_SECRET`, `EVENT_CORE_HMAC_SECRET`.
- Open events secret: 같은 `EVENT_CORE_HMAC_SECRET`만 둡니다.
- Slack app: `reactions:read` scope와 `reaction_added`, `reaction_removed` event subscription을 적용한 뒤 앱을 다시 설치합니다.
- Slack reaction 처리는 표준 `raising_hand`만 관심 상태로 매핑합니다. 다른 커스텀 이모지는 자동 의미를 부여하지 않습니다.
- 배포 후 Core `/health`, Open events `/health`, 실제 서명 링크의 state/configure/vote/finalize, Slack 카드 갱신을 확인합니다.

새 이벤트 기능은 먼저 Core 권한이 필요한지 판단합니다. 공개 UI만 바꾸면 Open Worker에서 처리하고, 회원 상태·DB·Slack mutation이 필요하면 좁은 Core 명령을 추가해 Founder 검토를 받습니다. Open 코드에 범용 Core HMAC, Slack token, DB 자격증명이나 SSH key를 추가하지 않습니다.
