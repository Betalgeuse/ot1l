# 데일리 스크럼 실행 경계와 2026-10-12 장애

## 관찰된 장애

10:00 KST 예약은 enabled였고 목표 10:00, 후기 18:00 설정도 정상이었다. 하지만 오늘 날짜의 common dispatch가 없었고 Slack에도 오늘 글이 없었다. 10:00 정각과 5분 간격 보완 실행이 모두 `Cron · exceededCpu`로 종료됐다.

실시간 Tail에서 추가로 관찰한 5분 Cron 한 건은 `cpuTime: 10`, `wallTime: 2552`, 로그·예외 0건이었다. API에서 usage model은 `standard`, 별도 CPU override는 없었지만 계정 구독 조회는 권한 부족으로 거부됐다. 따라서 **실측 CPU 종료는 확인했지만 유료/무료 요금제 원인은 확인하지 못했다.** 특정 유지보수 함수 하나가 무한 반복했다는 증거도 없다.

기존 경로는 PO 회원 전체 조회, 피드백 backfill, 이벤트, PR 상태, 알림, 챕터, garden, 회원 작업을 마친 뒤에야 daily schedule을 호출했다. 애플리케이션의 try/catch는 플랫폼 CPU 강제 종료를 복구하지 못한다. 5분 Cron도 같은 경로였으므로 독립 복구가 아니었다. 이전 atomic receipt 패치는 Slack 수락 이후 중복을 방지했지만 **dispatch 생성 전 실행 고갈**은 방지하지 않았다.

오늘 누락분은 기존 `runCommunitySchedule`과 DB claim/atomic receipt로 10:18 KST 복구했다. 재실행 결과 common=0, Slack root 한 건을 확인했다. 임의의 `chat.postMessage`나 lease 초기화로 우회하지 않았다.

## 변경한 계약

| 신호 | 실행 대상 | 책임 |
| --- | --- | --- |
| `0 1 * * *`, `0 9 * * *`, `*/5 * * * *` | `scrum:<team>:<channel>` 전용 CommunityClock RPC | 목표·후기 root와 개인 reminder, public 채널 우선 |
| `1,31 * * * *` | `maintenance:<team>` 별도 CommunityClock RPC | 반시간 backup reconciler와 maintenance |
| `1-59/5 * * * *` | `clock_recovery` 전용 task RPC | bug clock alarm 재무장만 수행하고 Neon을 열지 않음 |
| 기존 bug / community alarm | 기존 역할의 객체 | 기존 outbox 및 회원·garden 재시도. 공통 daily root는 생성하지 않음 |

Cron은 DB·Slack 업무를 직접 실행하지 않고 내부 RPC를 전달한다. 채널별 객체는 동시 실행을 직렬화하고 역할/채널을 영속 저장한다. scrum 객체에는 alarm을 만들지 않는다. **Cron이 유일한 스케줄 소유자이며, DO는 실행·직렬화 경계다.** 다른 큐가 CPU를 소모해도 scrum 실행의 CPU 예산을 사용하지 않는다. binding이 없으면 inline fallback하지 않고 실패한다.

[Cloudflare DO 제한 문서](https://developers.cloudflare.com/durable-objects/platform/limits/)는 RPC/Alarm CPU 기본 한도를 30초로 명시한다. 로컬 runtime 검사는 RPC 경계와 동작을 검증하지만 운영 CPU 여유를 측정하지는 않는다. 계정 요금제를 바꾸거나 과금 한도를 올리는 변경은 포함하지 않는다.

공통 root를 먼저 전송하고 그 뒤 개인 reminder 조건을 조회한다. feedback·PO·share-info·PR metadata·agent notification·garden·membership backup은 KST 매시 01분과 31분 tick에 맞춘다. exact due delivery는 기존 task/alarm 경로에서 처리한다. `clock_recovery`는 bug clock alarm만 DB 없이 재무장한다. 추가 Cron은 Broker 배포 스크립트가 `--triggers`로 적용한다.

## 유지하는 Slack UI 계약

| 사용자 / 표면 | 보존할 내용 | 검증 |
| --- | --- | --- |
| 일반 회원 / daily root | 날짜, ONE THING 기록·후기 버튼, 안내·초대, 피드백, Product Owner 되기 | action_id와 actor-bound value, 실제 blocks readback |
| 기록 버튼 | Slack의 실제 클릭한 회원으로 모달 열기 | 서명된 클릭으로 입력 모달 확인. 임의 회원 이름 입력 없음 |
| 입력 / 스레드 | common receipt와 prompt/thread가 같은 날짜 root를 가리킴 | 기존 DB atomic receipt 검사 |
| Founder / 수정 배포 | exact SHA 검증 후 Founder 승인, Broker 병합·배포 | 로컬 검사나 수동 누락 복구를 배포 완료로 보고하지 않음 |

## 재현·출시 검사

- `bun run check`: Worker entry의 Cron 전달, RPC 분리, 공개 채널 우선, 역할 충돌·disabled/maintenance, UI actions, 기존 기능 회귀 검사.
- `node qa/community-scrum-runtime.mjs`: 실제 workerd와 SQLite DO를 사용. Neon/Slack만 로컬 가짜 서비스로 격리하며 예상 밖 네트워크는 거부. 정각/보완 동시 실행, root 한 건, DB 장애 후 다음 Cron 복구, 외부 유지보수 쿼리 0건 검증.
- `node qa/atomic-common-delivery-pg.mjs`: 임시 socket-only PostgreSQL에서 불확실한 전송 재게시 금지와 dispatch·prompt·thread 한 트랜잭션 확인.
- 운영 완료 게이트: exact SHA의 Broker 배포 영수증, 실제 4개 Cron readback, `community.scrum.start/end`와 DO 실행 outcome/CPU, 다음 due 날짜의 dispatch `sent` 및 Slack root/버튼, 중복 0건.

2026-10-12 복구 글에서 Founder 브라우저의 ONE THING 버튼으로 입력 모달을 열고 닫았다. 입력을 제출하거나 회원의 목표를 변경하지 않았다. **일반 회원/operator 세션 QA와 새 구조의 운영 scheduled invocation은 아직 미검증이다.**

## 운영 복구

1. KST due 시각, normalized `channel_schedules`, 실제 Cron 등록·실행 outcome부터 확인한다. `/health`의 ok는 daily delivery 성공 증거가 아니다.
2. 해당 날짜 `common:<date>:goal|review`와 실제 Slack root를 대조한다. `claimed/failed` 또는 수락 불확실 상태이면 기존 history reconciliation을 사용하고 임의 재게시하지 않는다.
3. `community.scrum.failed`, `community.scrum.delivery.failed`, 객체 `lastRun`을 확인한다. `finished`는 실행 종료 기록이며 전송 성공은 DB `sent`와 Slack readback으로 별도 확인한다. 실패한 전송을 숫자 0의 정상 Cron으로 숨기지 않는다.
4. Cron 도착·DB·Slack 장애는 여전히 가능하다. 다음 5분 실행이 같은 durable dispatch를 재확인한다. 3회 시도 한도를 넘거나 수락 불확실성이 풀리지 않으면 원본·lease를 보존하고 운영자가 대조한다. 자동 무한 재전송하지 않는다.

이 설계는 관찰된 CPU 예산 결합을 제거한다. 99.99% 가용성이나 외부 장애까지 포함한 exactly-once를 증명하지 않는다.

## 2026-10-19 Neon 한도 소진

### 관찰

2026-10-19 15:20 KST, 데일리 스크럼 root가 생성되지 않았고 Neon 연결은 `Your account or project has exceeded the quota`로 실패했다. GenQuant runner와 deployer도 같은 DB 오류로 재시작을 반복했다. 계정 요금제나 한도 값은 이 저장소에서 확인하거나 추정하지 않는다.

### 원인과 wake budget

5분 maintenance와 scrum 호출, 60초 queue 재시도가 idle 시간에도 Neon을 열어 compute가 suspend할 idle 구간을 없앴다. 이제 일반 backup reconcilers는 KST 매시 :01과 :31에 정렬하고, scrum은 DO 저장 schedule/done cache로 due가 없는 tick을 Neon 없이 종료한다. schedule cache는 최대 1시간마다 새로 읽고 편집 직후 RPC로 무효화한다. 빈 cache는 Neon에서 읽어 fail-safe로 동작한다. exact due 전달은 기존 task/alarm deadline을 유지한다. `clock_recovery`는 Neon을 열지 않는다.

| 경로 | KST cadence | idle일 때 Neon window |
| --- | --- | --- |
| maintenance backup reconciler | :01, :31 | 최대 48개/일 |
| schedule cache miss/refresh | maintenance tick과 정렬 | 위 window에 포함 |
| daily goal/review root | 10:00, 18:00 | 2개/일 |
| bug clock safety scan | 6시간 간격 | 최대 4개/일 |
| clock recovery | 5분 RPC | 0개/일 |
| **계약** | KST 날짜 기준 | **distinct 5분 window 최대 60개** |

위 표는 정해진 cadence의 예상치다. 실제 운영의 Neon 사용량이나 무료 범위를 뜻하지 않으며, 활동·backlog·due alarm은 별도 wake를 만들 수 있다.

### 복구

1. Neon 계정에서 한도를 확인하고 필요한 경우 소유자가 upgrade 또는 reset을 결정한다. 이 변경은 요금제나 한도를 바꾸지 않는다.
2. 연결이 회복되면 기존 5분 scrum recovery 실행이 오늘 날짜 dispatch를 다시 확인하고 누락된 root를 보낸다. 재시도 한도나 불확실한 Slack 수락은 기존 receipt 절차를 따른다.
3. Slack에서 오늘의 goal/review root와 버튼을 readback하고, DB dispatch가 `sent`인지 별도로 확인한다. `/health`만으로 전달 성공을 판단하지 않는다.
