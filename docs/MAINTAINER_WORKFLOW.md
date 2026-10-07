# Maintainer 작업 흐름

Maintainer는 회원의 문제를 함께 정의하고, DRI를 맡거나 넘기고, 검증된 변경을 승인하는 역할입니다. 코딩 여부와 무관하게 제품·디자인·운영·행사 기여를 할 수 있습니다. Slack 역할, GitHub 권한과 운영 비밀은 서로 자동으로 따라오지 않습니다.

이 문서는 작업 계약입니다. 정적 문서의 “구현됨” 문구는 운영 상태를 증명하지 않습니다. 현재 단계와 DRI는 OT1L DB를 정본으로 하는 Slack `#maintainers` 카드와 홈페이지 `/maintainers`에서 확인합니다.

## 참여와 채널

- 회원이 **Maintainer 되기**를 누르면 본인만 역할 활성화를 요청합니다. 다른 회원을 일괄 승격하지 않습니다.
- 활성화가 성공하면 설정된 `#maintainers`, `#maintainers-dev`, `#maintainers-design`, `#maintainers-retention`, `#sys-alert` 소속을 확인합니다.
- `#maintainers`는 제안·DRI·단계·승인·완료 영수증의 canonical 작업 채널입니다.
- `#maintainers-dev`는 AI나 동료와 만들며 배우는 공간이고 봇 로그 보관함이 아닙니다.
- `#maintainers-design`은 화면, 콘텐츠, 접근성, 사용자 경험을 다룹니다.
- `#maintainers-retention`은 시작 안내, 질문, Q&A 허들, 첫 기여 OT와 커뮤니티 운영을 다룹니다.
- `#sys-alert`는 정제된 배포 실패와 장애 요약만 받습니다. 요청 본문, 토큰, 쿠키, 이메일, IP, 원본 stack trace와 DB 주소는 게시하지 않습니다.

각 Maintainer 채널 Canvas는 권한보다 회원이 얻는 경험, 첫 참여 방법, 예시와 도움받을 위치를 먼저 설명합니다.

## 한 작업의 정본

일반 피드백 채널과 `#maintainers` 모두 작업을 시작할 수 있습니다. 한 제안은 OT1L DB의 작업 하나와 회원용·Maintainer용 Slack 투영으로 연결됩니다.

- Maintainer가 직접 제안하면 본인이 기본 DRI입니다.
- 제안자와 DRI는 별개이며, 활성 Maintainer 사이에서 드롭다운으로 넘길 수 있습니다.
- 카드는 실제 As-Is, To-Be, 현재 단계, DRI, 원문 위치와 필요한 다음 행동을 유지합니다.
- 허용 단계는 제안됨, 진행 중, 검토 중, 도움 필요, 반영 중, 완료입니다.
- AI는 구현을 대행할 수 있지만 사람 DRI를 대신하지 않습니다.
- 개인정보·보안 제보는 공개 카드나 외부 이슈 트래커로 복사하지 않습니다.

## 변경과 승인

공개 Contributor와 Maintainer는 GitHub collaborator 초대 없이 자신의 fork에서 개발하고 PR을 엽니다. upstream push나 운영 비밀은 필요하지 않습니다.

| 변경 | 승인자 | 배포 |
| --- | --- | --- |
| Open 이벤트 UI 경로 | 활성 Maintainer 또는 Founder | Deployment Broker |
| Core, migration, 회원·개인정보·Slack·일반 홈페이지 | Founder | Deployment Broker |
| 경로 혼합 또는 분류 불명 | Founder, Core로 fail-closed | Deployment Broker |

승인은 검증한 정확한 head SHA와 변경 경로 digest에 묶입니다. SHA나 경로가 바뀌면 기존 승인은 무효입니다. 개인 컴퓨터에서 운영 Worker를 직접 배포하지 않으며, Broker가 전체 검사, 병합, 대상별 배포, health와 실제 동작 영수증을 남깁니다.

현재 자동 큐는 OT1L 피드백 흐름이 만든 PR을 기준으로 합니다. 외부에서 직접 만든 PR을 자동 등록하는 셀프서비스는 아직 없습니다. `#maintainers`에 PR을 연결하고 Founder가 작업과 정확한 SHA를 확인해야 같은 Broker 경로를 사용할 수 있습니다.

## Linear의 위치

Linear는 선택적 미러이며 작업 정본이나 필수 계정이 아닙니다. 명시적으로 켠 경우에만 OT1L 팀 이슈를 만들고 Slack DRI를 반영합니다. 연결 실패가 Slack 작업, 승인 또는 배포를 막거나 되돌리지 않습니다. DEV 팀, 워크스페이스 역할과 운영 비밀은 건드리지 않습니다.

## 완료 조건

다음은 서로 다른 증거입니다.

1. 코드와 migration이 존재한다.
2. 합성 검사가 버튼·권한·상태 전이를 통과한다.
3. 정확한 SHA가 승인·병합되고 대상 Worker가 배포된다.
4. 일반 회원, 활성 Maintainer, Founder가 각자 필요한 실제 Slack 경로를 확인한다.

초기 카드만 보이는 것으로 완료하지 않습니다. DRI 변경, 단계 변경, 승인, 병합, 배포 뒤 `chat.update`가 전체 컨트롤을 보존하는지 다시 읽습니다. 직접 만든 PR의 셀프서비스 등록과 모든 역할의 운영 클릭 QA가 끝나지 않았다면 그 한계를 작업 카드에 남깁니다.

로컬 개발과 fork 절차는 [기여 시작하기](../CONTRIBUTING.md), 배포 경계는 [개발 가이드](DEVELOPMENT.md), 장애 대응은 [운영 가이드](OPERATIONS.md)를 따릅니다.
