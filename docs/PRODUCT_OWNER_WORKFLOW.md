# Product Owner 작업 흐름

Product Owner는 회원의 문제를 함께 정의하고, DRI를 맡거나 넘기고, 검증된 변경을 승인하는 역할입니다. 코딩 여부와 무관하게 제품·디자인·운영·행사 기여를 할 수 있습니다. Slack PO 역할, GitHub 권한과 운영 비밀은 서로 자동으로 따라오지 않습니다.

이 문서는 작업 계약입니다. 현재 단계와 DRI는 OT1L DB를 정본으로 하는 Slack `#po-work` 카드와 홈페이지 `/po`에서 확인합니다. 정적 문서, PR 또는 테스트만으로 운영 반영을 주장하지 않습니다.

## 공간을 분리합니다

- `#po`: 아이디어, 질문, 사용자 경험, Q&A와 활동을 이야기하는 공간
- `#po-work`: As-Is·To-Be, DRI, 단계, 검증, 승인, 병합·배포 영수증의 작업 정본
- `#po-design`: 화면, 콘텐츠, 정보 구조와 접근성
- `#po-dev`: 기능, 재현, QA, 코드와 페어 작업
- `#po-sys-alert`: 정제된 배포 실패와 장애 요약

대화가 길어져도 작업 상태는 `#po-work`의 한 canonical 스레드만 갱신합니다. 원본 로그, 토큰, 쿠키, 이메일, IP, stack trace와 DB 주소를 공개 채널에 복사하지 않습니다.

## 참여와 멘션

- 회원이 **Product Owner 되기**를 누르면 버튼을 누른 본인만 역할 활성화를 요청합니다.
- 성공 조건은 DB 역할 `active`, 다섯 PO 채널 가입, `@po` 사용자 그룹 가입의 실제 readback입니다.
- `@po`는 모든 활성 Product Owner입니다.
- `@po-designer`와 `@po-dev`는 **전문 그룹 설정**에서 본인이 선택하거나 해제합니다.
- 채널 가입은 대화를 볼 수 있는 범위이고, 사용자 그룹은 필요한 사람을 멘션하는 범위입니다. 둘을 같은 권한으로 취급하지 않습니다.
- 내부 DB·함수의 `maintainer` 명칭은 기존 migration과 감사 이력 호환성을 위해 유지하며 사용자 화면에는 노출하지 않습니다.

## 한 작업의 정본

일반 피드백 채널과 `#po`에서 제안을 시작하고, 실행하기로 하면 OT1L DB 작업 하나와 회원용·PO용 Slack 투영으로 연결합니다.

- Product Owner가 직접 제안하면 본인이 기본 DRI입니다.
- 제안자와 DRI는 별개이며 활성 Product Owner 사이에서 넘길 수 있습니다.
- 카드는 실제 As-Is, To-Be, 현재 단계, DRI, 원문 위치와 다음 행동을 유지합니다.
- 단계는 제안됨, 진행 중, 검토 중, 도움 필요, 반영 중, 완료로 구분합니다.
- AI는 구현을 대행할 수 있지만 사람 DRI를 대신하지 않습니다.
- 개인정보·보안 제보는 공개 카드나 외부 이슈 트래커로 복사하지 않습니다.

## 변경과 승인

공개 Contributor와 Product Owner는 GitHub collaborator 초대 없이 자신의 fork에서 개발하고 PR을 엽니다.

| 변경 | 승인자 | 배포 |
| --- | --- | --- |
| Open 이벤트 UI 경로 | 활성 Product Owner 또는 Founder | Deployment Broker |
| Core, migration, 회원·개인정보·Slack·일반 홈페이지 | Founder | Deployment Broker |
| 경로 혼합 또는 분류 불명 | Founder, Core로 fail-closed | Deployment Broker |

승인은 검증한 정확한 head SHA와 변경 경로 digest에 묶입니다. SHA나 경로가 바뀌면 기존 승인은 무효입니다. 개인 컴퓨터에서 운영 Worker를 직접 배포하지 않으며 Broker가 전체 검사, 병합, 대상별 배포, health와 실제 동작 영수증을 남깁니다.

현재 자동 큐는 OT1L 피드백 흐름이 만든 PR을 기준으로 합니다. 외부 PR 자동 등록 셀프서비스는 아직 없습니다. `#po-work`에 PR을 연결하고 Founder가 작업과 정확한 SHA를 확인해야 같은 Broker 경로를 사용합니다.

## Linear의 위치

Linear는 선택적 미러이며 작업 정본이나 필수 계정이 아닙니다. 명시적으로 켠 경우에만 OT1L 팀 이슈를 만들고 Slack DRI를 반영합니다. 연결 실패가 Slack 작업, 승인 또는 배포를 막거나 되돌리지 않습니다.

## 완료 조건

1. 코드와 migration이 존재한다.
2. 합성 검사가 버튼·권한·상태 전이를 통과한다.
3. 정확한 SHA가 승인·병합되고 대상 Worker가 배포된다.
4. 일반 회원, 활성 Product Owner, Founder가 각자 필요한 실제 Slack 경로를 확인한다.

초기 카드만 보이는 것으로 완료하지 않습니다. 승격 직후 채널·`@po`, 전문 그룹 변경, DRI·단계 변경, 승인, 병합과 배포 뒤의 전체 카드를 다시 읽습니다.

로컬 개발과 fork 절차는 [기여 시작하기](../CONTRIBUTING.md), 배포 경계는 [개발 가이드](DEVELOPMENT.md), 장애 대응은 [운영 가이드](OPERATIONS.md)를 따릅니다.
