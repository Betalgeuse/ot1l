# 문서 안내

문서는 서로 다른 종류의 사실을 섞지 않습니다. 제품 계약은 원하는 동작을, 코드는 실행 가능한 동작을, 배포 영수증과 실제 Slack·브라우저 관찰은 운영 반영을 증명합니다. 하나가 다른 하나를 대신하지 않습니다.

## 현재 권위

| 질문 | 기준 문서·실행 원본 | 증명하지 않는 것 |
| --- | --- | --- |
| OT1L이 왜 존재하고 무엇을 우선하는가 | [제품 원칙](PRODUCT_PRINCIPLES.md) | 구현·배포 완료 |
| ONE THING 입력·저장·후기 규칙은 무엇인가 | [실행 명세](SPEC.md) | 이벤트·Product Owner의 모든 세부 동작 |
| 회원은 어떻게 사용하는가 | [사용 가이드](USER_GUIDE.md) | 운영 권한 |
| 이벤트는 어떻게 열고 참가하는가 | [Townhall 이벤트](EVENTS.md) | Core 배포 권한 |
| Product Owner는 어떻게 이야기하고 작업·승인하는가 | [Product Owner 작업 흐름](PRODUCT_OWNER_WORKFLOW.md), `automation/runner/change-policy.mjs` | 문서만으로 얻는 역할·비밀·배포 권한 |
| Worker·DB·외부 경계는 어떻게 나뉘는가 | [시스템 구조](ARCHITECTURE.md), 현재 코드와 migration | 운영 배포 완료 |
| 복구·알림·장애 대응은 어떻게 하는가 | [운영 가이드](OPERATIONS.md) | 제품 정책 변경 |
| 설치·검사·PR은 어떻게 하는가 | [개발 가이드](DEVELOPMENT.md), [기여 시작하기](../CONTRIBUTING.md) | 운영 비밀 접근 |

현재 작업 단계와 DRI는 정적 문서나 과거 버전 표가 아니라 OT1L DB를 정본으로 하는 Slack `#po-work` 카드와 홈페이지 `/po`에서 확인합니다. 완료는 정확한 SHA의 병합, 대상 Worker 배포, health와 실제 사용자 경로 확인이 모두 끝났을 때만 표시합니다.

## 디렉터리

- `docs/`의 대문자 문서는 현재 제품·운영·개발 계약입니다.
- `docs/research/`는 근거, 가설, 설계 과정입니다. 현재 정책이나 구현 완료를 선언하지 않습니다.
- `docs/qa/`는 날짜와 범위가 있는 관찰 기록입니다. 일반화된 현재 동작을 대신하지 않습니다.
- `docs/archive/`는 과거 로드맵·출시 번호·폐기된 설명입니다. 현재 작업 순서로 사용하지 않습니다.
- `docs/vendor/`는 외부 자료와 라이선스입니다.

## 상태를 읽는 법

1. **계약:** 문서가 의도와 불변조건을 정의합니다.
2. **실행 가능:** 현재 `public/main` 코드와 migration에 도달 가능한 경로가 있습니다.
3. **검증:** 합성 검사 또는 별도 통합 검사가 특정 계약을 확인합니다.
4. **운영 반영:** 정확한 SHA와 Worker version, DB migration, Slack·브라우저 readback이 연결됩니다.

테스트 통과만으로 4단계를 주장하지 않습니다. 브랜치나 PR에만 있는 코드를 현재 운영 기능으로 쓰지 않습니다. feature flag가 꺼진 경로, 선택 연동, 과거 관찰도 현재 기본값과 구분합니다.

## 호환 문서

- [과거 로드맵](ROADMAP.md)과 [과거 업데이트 이력](UPDATE_HISTORY.md)은 기존 외부 링크를 보존하는 안내 페이지입니다.
- [이전 이벤트·Maintainer 통합 문서](EVENTS_AND_MAINTAINERS.md), [이전 Maintainer 문서명](MAINTAINER_WORKFLOW.md)과 [이전 Linear 중심 문서명](MAINTAINER_LINEAR.md)은 새 Product Owner 문서로 연결만 합니다.

## 문서 변경 규칙

- 같은 현재 사실을 여러 문서에 복사하지 않고 권위 문서로 연결합니다.
- 실행 동작을 바꾸면 계약, 코드, 회귀 검사와 관찰 범위를 같은 PR에서 갱신합니다.
- 역사 기록은 수정해 현재처럼 만들지 않고 `archive/`에 보존합니다.
- 연구·제안은 `research/`에 날짜, 근거, 한계와 확정 여부를 남깁니다.
- 문서 정리, 테스트 통과, PR 병합, 운영 배포와 실제 사용 확인을 각각 별도 사실로 보고합니다.
