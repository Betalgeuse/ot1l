# 예약 작업 중단과 완료 확인

상태: 구현·로컬 검증 완료, 운영 미배포. 먼저 알림 배포 경계 PR #150을 Founder/Broker 절차로 반영하고 이 변경을 새 정책으로 재검증해야 한다.

## 확인한 문제

- 2026-10-12 13:30과 14:27의 Slack 알림은 `Alarm · canceled`, 예외 0건이었다. 취소 원인은 당시 상세 로그 권한이 없어 미확정이다. 이후 다른 실행이 성공했다는 이유로 해당 두 작업을 완료 처리하지 않는다.
- 기존 알림기는 `outcome !== ok`를 모두 빨간 실패로 표시했고, 객체/실행 식별자를 보관하지 않아 후속 완료와 대조하지 못했다.
- 기존 배포 정책은 `src/log-alert-worker.ts`도 `core-worker` 대상으로 분류했다. 알림 전용 Worker 반영과 Core 반영을 분리하는 선행 정책이 필요하다.

## 식별과 판정

Core queue alarm은 durable storage에 무작위 `cycleId`와 시도 번호를 저장한다. 중단·불완료 재시도는 같은 ID를 사용한다. garden 발송·retention·회원관리 실패 또는 backlog가 남으면 완료 영수증을 만들지 않는다. 오류 없이 제한된 실행을 마치면 완료 시각을 저장하고 다음 실행에서 한 번 재전달한다. 이 표시는 해당 예약 실행의 완료이며 모든 미래 작업이나 서비스 전체 무오류를 뜻하지 않는다.

정상 함수 반환만으로 완료하지 않는다. 별도 읽기 전용 DB 검사로 관련 큐의 처리 중 claim, 실패·dead 항목, due outbox 및 실패한 private purge가 없는지 확인한다. 이 검사는 기존 보류·실패도 포함하는 보수적인 조건이므로 다른 미처리 항목 때문에 완료 확인이 늦어질 수 있다. 접근 권한 부족·DB 조회 실패·항목 잔존 시 녹색으로 바꾸지 않는다. 업무 처리는 계속되며 알림 판정만 미확인으로 남긴다.

Tail은 실제 `scriptName + durableObjectId + cycleId`를 SHA-256으로 묶는다. 운영 원본 object ID, 회원 정보, 요청 URL, 예외 원문은 Slack이나 incident state에 전달하지 않는다. 실제 운영 Tail에서 object ID가 제공되는 것은 확인했지만, 새 연결 경로의 운영 검증은 아직 남았다.

완료 판정은 신뢰하는 Core alarm의 명시적 완료 영수증이 있고 해당 trace가 정상 종료·예외 0·error 로그 없음·잘리지 않음일 때만 허용한다. 다른 객체, 다른 실행, 잘린 로그, 예외가 있는 실행은 완료 증거로 쓰지 않는다. 로그가 작업 시작 전 끊겨 ID가 없으면 미확인 경고로 남는다.

## Slack 표면 계약

| 관찰 | 표시 | 이후 변화 |
| --- | --- | --- |
| 식별 가능한 중단 | 노란색 `예약 실행 중단 · 복구 확인 중` | 같은 incident의 메시지만 갱신 |
| 같은 실행 완료 영수증 | 초록색 `예약 실행 완료 확인` | 뒤늦은 중단 로그가 도착해도 이전 상태로 되돌리지 않음 |
| 10분 동안 완료 증거 없음 | 빨간색 `예약 실행 복구 미확인` | 운영 점검 대상, 나중에 정확한 완료 증거가 오면 갱신 가능 |
| 식별자 없는 취소 | `실행 중단 · 복구 미확인` | 과거 로그 없이 자동 완료 처리하지 않음 |
| 예외/CPU 초과/HTTP 5xx 등 실제 실패 | 기존 실패 경고 | 이 기능이 숨기거나 완료로 간주하지 않음 |

10분은 기존 5분 안전 점검의 두 주기를 관찰하는 알림 기준이며 가용성 SLA가 아니다. #po-sys-alert를 보는 회원은 역할에 관계없이 같은 진단 카드를 본다. 제보·DRI·병합 권한 버튼은 이 카드에 추가하지 않는다. Core 변경은 별도의 #po-work Founder 승인 절차를 유지한다.

## 전달과 상태 보존

알림 전용 SQLite Durable Object가 incident별 상태와 Slack timestamp를 보관한다. 중복·역순 관찰과 객체 재시작에도 한 메시지를 유지한다. Slack 수락 응답을 잃은 경우 해당 봇이 쓴 고유 block marker를 제한된 history에서 먼저 확인한다. 확인되지 않으면 임의 재게시하지 않는다. 명시적 거절은 재시도하며 전송 실패는 별도 기록한다. 정상·완료 영수증만 먼저 도착하면 메시지 없이 보관하고 나중에 대응하는 중단이 오면 대조한다. 상태는 7일 후 제거하되 Slack 기록을 삭제하지 않는다.

한계: 무제한 exactly-once를 보장하지 않는다. history 범위를 넘어간 수락 불확실 상태와 모든 복구 증거가 유실된 상태는 수동 대조가 필요하다. Tail 자체/Slack 장애 시 외부 알림 전달도 지연될 수 있다. 과거의 식별자 없는 카드 두 건은 소급 완료할 수 없다.

## 검사 및 배포

- `bun run check`: 실제 producer 출력과 parser 계약, 잘못된 identity/예외/잘린 trace 거부, 중복·역순·deadline·lost-response 검사.
- `node qa/community-alarm-runtime.mjs`: 실제 workerd에서 I/O 중 객체 중단 후 같은 cycle ID가 보존됨.
- `node qa/log-alert-runtime.mjs`: 실제 workerd와 SQLite state를 재시작하고 Tail parser → incident RPC → Slack 갱신 검증. Slack만 로컬 가짜 서비스이며 운영 호출은 없다.
- `bun qa/alarm-recovery-proof-pg.mjs`: 실제 migration을 적용한 격리 PostgreSQL에서 pending, 미래까지 점유된 claim, 시도를 소진한 failed는 미완료이며 sent만 완료 조건을 충족함을 검증.
- 알림 번들 dry-run에서 `AlarmIncident` namespace와 migration을 확인. Broker는 기존 비공개 설정을 임시 0600 파일에 합성해 배포하고 기존 private config/secret 값을 변경하지 않는다.
- 출시 후 두 Worker의 정확한 버전, 실제 canceled/complete 연결, 같은 메시지 갱신, 실제 실패 알림 보존을 확인해야 운영 완료다. 테스트용 취소를 운영 알람에 주입하지 않는다.
