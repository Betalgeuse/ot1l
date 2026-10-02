# Townhall 이벤트와 Maintainer 운영

## 회원용 이벤트 사용법

1. `#townhall`의 고정된 **이벤트 열기**를 누릅니다.
2. 주최자 이름은 입력하지 않습니다. Slack에서 누른 회원을 `<@mention>님이 이벤트를 열었어요`로 표시합니다.
3. 활동과 장소 또는 접속 방법을 적습니다. 시간을 아직 모르면 비워 둔 채 먼저 모집할 수 있습니다.
4. 이벤트 글의 **가능 시간 선택**을 열어 최대 14일, 30분 또는 1시간 간격의 시간표, 진행 시간과 성사 조건을 설정합니다.
5. 참여자는 가능한 칸을 누르거나 드래그해 복수 선택하고 저장합니다. Slack에는 개인별 시간표 대신 칸별 가능 인원만 표시합니다.
6. 주최자는 한 칸을 최종 일정으로 확정합니다. 정기 모임이면 매주 또는 격주와 2–24회 회차를 선택하며, 확정 시 각 회차가 실제로 생성됩니다.
7. 주최자는 이벤트를 여는 즉시 참가 확정 1명으로 포함됩니다. 일정 확정 뒤 다른 회원은 **참가 확정**으로 참석 의사를 남기며, 정원이 차면 추가 신청은 대기자로 기록합니다.

`🙋` 리액션은 관심 신호이며 참가 확정이나 실제 참석으로 세지 않습니다. 모집 마감에 최소 인원이 부족하면 취소 유예로 바뀌고, 설정한 유예가 끝날 때까지도 미달이면 자동 취소·보관합니다. 다른 활동 수요는 이벤트 스레드에 남깁니다.

현재 Slack의 **이벤트 수정**은 활동·장소·기존 후보 수정에 사용합니다. 성사 조건이나 시간표를 크게 바꾸는 경우 웹 시간표에서 다시 설정하고 최종 시간을 재확정합니다.

## Maintainer와 승인 경계

- 모든 회원은 welcome 또는 `#maintainers`의 **Maintainer 되기**로 역할을 스스로 활성화할 수 있습니다.
- Open 변경은 활성 Maintainer 한 명이 검증 결과와 정확한 head SHA를 확인해 승인하면 병합과 배포가 이어집니다.
- 이벤트 공개 화면은 별도 `otl1-open-events` Worker에서 실행합니다. 이 Worker에는 Slack token, DB URL, SSH key가 없고 이벤트 전용 Core 서명키만 있습니다.
- 가입, 개인정보, 보안, Slack 처리와 Core Worker 코드 변경은 Founder 승인 뒤에만 병합·배포합니다. DB migration과 일반 홈페이지처럼 별도 순서가 필요한 변경은 Founder 승인 뒤에도 자동 배포하지 않고 운영 절차로 넘깁니다.
- 경로가 섞였거나 분류 digest 또는 head SHA가 바뀌면 승인은 무효가 되며 다시 검증해야 합니다.
- Deployment Broker는 승인된 SHA만 fast-forward하고 전체 검사, 배포, health 확인 뒤 영수증을 남깁니다. Maintainer에게 GenQuant SSH나 Cloudflare token을 전달하지 않습니다.

Open 경로의 기준은 `automation/runner/change-policy.mjs`이며 fail-closed입니다. 현재는 `event-site/**`와 이벤트 시간표의 정적 자산·QA만 Open입니다. `src/**`, `migrations/**`, 가입·개인정보·보안 경로는 Core입니다.

## 운영 점검

- DB: `067`–`071` migration이 순서대로 적용되어야 합니다.
- Core secrets: `EVENT_SIGNING_SECRET`, `EVENT_CORE_HMAC_SECRET`.
- Open events secret: 같은 `EVENT_CORE_HMAC_SECRET`만 둡니다.
- Slack app: `reactions:read` scope와 `reaction_added`, `reaction_removed` event subscription을 적용한 뒤 앱을 다시 설치합니다.
- Slack reaction 처리는 표준 `raising_hand`만 관심 상태로 매핑합니다. 다른 커스텀 이모지는 자동 의미를 부여하지 않습니다.
- 배포 후 Core `/health`, Open events `/health`, 실제 서명 링크의 state/configure/vote/finalize, Slack 카드 갱신을 확인합니다.

새 이벤트 기능은 먼저 Core 권한이 필요한지 판단합니다. 공개 UI만 바꾸면 Open Worker에서 처리하고, 회원 상태·DB·Slack mutation이 필요하면 좁은 Core 명령을 추가해 Founder 검토를 받습니다. Open 코드에 범용 Core HMAC, Slack token, DB 자격증명이나 SSH key를 추가하지 않습니다.
