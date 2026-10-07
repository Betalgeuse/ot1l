# 개발 가이드

Townhall 이벤트 사용법은 [Townhall 이벤트](EVENTS.md), Product Owner의 Open/Core 승인 경계와 배포 점검은 [Product Owner 작업 흐름](PRODUCT_OWNER_WORKFLOW.md)을 기준으로 합니다.

처음 기여하는 사람이나 AI 개발 도구는 루트의 [기여 시작하기](../CONTRIBUTING.md)와 [`AGENTS.md`](../AGENTS.md)부터 읽습니다. 공개 저장소이므로 GitHub 초대 없이 fork와 PR로 작업하며, upstream push와 운영 배포 권한은 별도로 두지 않습니다.

## 시작과 검증

Bun과 Node.js 24를 사용합니다. 개발 도구 버전은 `package.json`과 `bun.lock`이 기준입니다.

```sh
bun install --frozen-lockfile
bun run check
```

`check`는 lint → TypeScript → 합성 회귀 → Wrangler dry-run 순서로 실행하며 실패 시 중단합니다. 실제 배포·운영 DB·Slack 발송은 호출하지 않습니다. 테스트 목록은 `scripts/test-unit.mjs` 한 곳에서 관리하며 각 검사는 새 Bun 프로세스에서 실행합니다.

## 설정과 배포

1. `.dev.vars.example`을 `.dev.vars`로 복사하고 로컬 값을 채웁니다. 완성된 파일은 Git에 넣지 않습니다.
2. `wrangler.jsonc`에 본인 계정의 Worker·관리자·공개 채널·feedback·townhall·welcome·자기소개 채널을 지정합니다. 자기소개 채널 Canvas를 만든 뒤 `COMMUNITY_INTRO_CANVAS_ID`와 `COMMUNITY_INTRO_CANVAS_URL`도 설정합니다. `COMMUNITY_FEEDBACK_CHANNEL_ID`는 버그 제보 전용 채널이며 공개 export에서는 반드시 placeholder로 치환합니다. 관리자 채널은 비공개로 유지합니다.
3. welcome 안내는 `src/community-guide-release.ts`의 버전·본문을 검토해 변경합니다. `COMMUNITY_GUIDE_CANVAS_ID`, `COMMUNITY_GUIDE_CANVAS_URL`, `COMMUNITY_GUIDE_ANCHOR_TS`는 같은 welcome 채널의 Canvas와 핀 메시지를 가리켜야 하며 공개 export에서는 예시 값으로 치환합니다. 사람의 Slack 원문 시각이나 해시는 발행 입력으로 쓰지 않습니다. migration 039 적용 뒤 `bun scripts/publish-welcome-guide.mjs`로 dry-run하고, `--apply`로 DB 발행본·Canvas·핀 메시지를 함께 갱신합니다.

4. 서명 키, 봇 토큰, DB URL, 보드 서명 키를 Wrangler secret으로 등록합니다. 값은 명령문·문서·공개 이력에 남기지 않습니다.
5. 앱 manifest를 생성해 Slack에 적용하고 필요한 채널에 봇을 연결합니다. 슬래시 `/one`은 사용하지 않습니다.

```sh
node scripts/slack-manifest.mjs https://YOUR-WORKER.workers.dev
bunx --no-install wrangler types worker-configuration.d.ts --env-interface CloudflareBindings
bun run check
```

입장 이벤트 구독과 봇 게시 권한을 실제 Slack 앱에서 확인합니다. 설정 파일 존재나 빌드 성공만으로 설치가 완료됐다고 하지 않습니다. 위 준비 명령은 배포 권한을 부여하지 않습니다.

### 배포 권한 구분

정식 출시·canonical 배포는 공개 저장소 `public/main`의 리뷰·squash merge 결과만 사용합니다. canonical preflight는 현재 full SHA, 단일 `public` remote, clean `main`, Actions 비활성화와 ruleset API readback을 확인해야 하며, 실패한 checkout이나 `main`과 공통 조상이 없는 브랜치에서 배포하지 않습니다.

이미 존재하는 Worker에서 최종 Slack 동작을 확인해야 할 때는 명시적으로 승인된 pre-release QA 배포만 예외로 허용합니다. 승인된 시나리오, clean full SHA, 이전·새 Worker version, migration 목록, maintenance 차단과 해제, read-only health·binding·Cron 보존, 별도 clock readiness 근거, rollback 대상과 정리 범위를 한 영수증에 묶습니다. 이 예외는 feature SHA를 canonical로 만들지 않으며, 정식 배포는 리뷰를 거쳐 `main`에 합쳐진 SHA만 사용합니다.

exact SHA `4f05ae75f93ad5f7bca6ebfcb7c3613fbe8dae20`은 과거 예외에서 Chrome Slack Web QA를 통과했지만 당시 `main`과 분리된 이력이어서 pre-release로만 보존합니다.

## DB 설치와 이관

신규 설치는 **공개 저장소의 빈 폐기 가능 DB**에 `migrations/`의 `NNN_*.sql`을 파일명 순서대로 모두 적용합니다. 번호의 빈칸은 역사적으로 사용하지 않은 번호이므로 임의 파일로 채우지 않습니다. 적용된 migration은 수정하지 않고 새 번호를 추가합니다. 정적 문서에 “최신 migration 목록”을 다시 복사하지 않습니다. 디렉터리와 각 파일의 `otl.schema_migrations` 기록이 실행 원본입니다.

로컬의 빈 DB에서만 다음처럼 전체 순서를 검증할 수 있습니다. 운영 DB에는 이 반복문을 사용하지 않습니다.

```sh
for migration in migrations/[0-9][0-9][0-9]_*.sql; do
  psql "$OTL1_LOCAL_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$migration"
done
```

운영 migration은 Founder가 승인한 exact SHA와 변경 경로에 포함된 파일만 Deployment Broker가 적용합니다. `automation/runner/migration-deployer.mjs`가 파일 형식, 단일 version 기록, 선행 migration 적용 여부와 readback을 검사합니다. DB 소유자 연결은 migration과 역할 부트스트랩에만 사용합니다.

GenQuant 실행기 역할은 `scripts/bootstrap-bug-runner-db-role.mjs`로 만들고 완성된 URL을 `BUG_RUNNER_SECRET_SINK`의 표준입력으로만 전달합니다. URL을 명령 인자·로그·Git에 쓰지 않습니다. 실행기 로그인은 runner 함수만 호출할 수 있고 bug·member·agent table을 직접 읽을 수 없습니다.

Founder가 승인한 migration을 Broker가 적용할 때는 `scripts/bootstrap-migration-db-role.mjs`로 `otl_migration_login`과 NOLOGIN `otl_migration_owner`를 만듭니다. 로그인은 `NOINHERIT`이고 평소에는 otl schema를 직접 읽거나 쓸 수 없습니다. Broker는 승인 digest에 묶인 migration 파일, 선행 버전과 파일 계약을 확인한 뒤 같은 DB 세션에서만 `SET ROLE otl_migration_owner`를 실행합니다. 생성된 URL은 `MIGRATION_SECRET_SINK`의 표준입력으로 GenQuant mode-0600 환경 파일에 설치하며 로그·Git·명령 인자에 넣지 않습니다.

회원 생성 Chapter를 열려면 078 뒤에 `079_self_service_chapters.sql`을 적용하고 Slack 앱에 `channels:manage`를 추가한 뒤 다시 설치합니다. 이 scope는 공개 `chapter-*` 생성·설명 설정·보관에만 사용합니다. 운영 채널 ID를 코드나 공개 config에 새로 박지 않습니다. 활성 동적 Chapter는 DB registry로 인식하고 15분 reconciliation에 자동 포함합니다.

신규 회원 안내는 운영 Slack 앱의 Bot Events에 `team_join`이 실제로 저장되어 있어야 합니다. 저장소 manifest만 확인하지 말고 Slack 앱 관리 화면을 재조회합니다. Migration 086부터 `team_join`은 회원별 guide·자기소개·reminder·Townhall outbox를 먼저 만들고 각 항목을 독립적으로 재시도합니다. 15분 회원 목록 대조가 이벤트 자체 누락도 찾아내되, migration 적용 당시 이미 활동 중인 회원은 legacy snapshot으로 제외해 과거 회원 전체에 환영 메시지를 재발송하지 않습니다.

`ops/genquant/otl1-bug-runner.service`를 설치하기 전에 `runner.env.example`을 사용자 전용 `~/.config/otl1-bug-runner/env`로 옮기고 mode 0600을 확인합니다. `BUG_RUNNER_ROOT`도 실행 사용자만 접근 가능한 디렉터리여야 합니다. 서비스는 Cloudflare나 Slack의 inbound 포트를 열지 않으며 Neon과 Codex Cloud로 outbound 요청만 보냅니다. 최초 운영 검증은 확정된 비공개 QA bug 하나로 실행하고, `task_started`와 `task_ready`가 같은 feedback 스레드에 한 번씩 돌아오는지 확인합니다.

Migration 028 뒤에는 DB 소유자 연결로 [환영 안내 DB 권한 부트스트랩](GUIDE_DATABASE_SECURITY.md)을 한 번 실행해 `GUIDE_DATABASE_URL`과 `GUIDE_ADMIN_DATABASE_URL`을 서로 다른 로그인으로 발급합니다. 소유자 연결은 migration과 부트스트랩에만 쓰고 Worker에는 넣지 않습니다. Worker에는 런타임 자격증명만, 발행 CLI를 실행하는 로컬 비밀 저장소에는 관리자 자격증명만 둡니다.

Migration 026·028과 DB 역할 부트스트랩을 마친 뒤 승인된 관리자 원본을 발행할 때만 아래 작업을 실행합니다. 인자 없이 실행하면 Slack 원본과 설정을 검증하는 dry run이며 DB를 바꾸지 않습니다. `--apply`를 붙인 실행만 `GUIDE_ADMIN_DATABASE_URL`을 사용해 발행본을 저장합니다. Slack 원본 편집만으로는 현재 발행본이 바뀌지 않습니다. 두 모드 모두 본문·토큰·DB 주소를 출력하지 않고 버전과 content hash만 출력합니다. 신규 회원 입장 처리는 Worker의 `GUIDE_DATABASE_URL`로 DB 최신 발행본만 읽습니다.

```sh
set -a
. ./.dev.vars
set +a
bun scripts/publish-welcome-guide.mjs
bun scripts/publish-welcome-guide.mjs --apply
```

이미 이전 안내를 받은 회원에게 새 hash의 수정본을 전달할 때도 dry run을 먼저 실행합니다. `--apply`는 `SLACK_BOT_TOKEN`의 OT1L 봇 프로필로 현재 발행본을 같은 회원에게 한 번 게시하고 반환된 bot message timestamp를 저장할 뿐, 기존 메시지를 삭제하지 않습니다. Slack Web에서 봇 프로필·멘션·본문·이미지 두 장을 확인한 다음 기존 메시지를 수동으로 정리합니다. 사용자 토큰이나 관리자 프로필 게시로 대체하지 않습니다.

```sh
bun scripts/publish-welcome-guide.mjs --replace-user U_REPLACE
bun scripts/publish-welcome-guide.mjs --replace-user U_REPLACE --apply
```

기존 DB는 **백업 → 별도 복원 → 원본 충돌 대조 → 쓰기 정리 → 이관 → 전후 비교 → 실제 사용자 확인** 순서로 다룹니다. 알 수 없는 충돌을 덮어쓰거나 검사를 제거하지 않습니다. 복구는 이관 뒤 생긴 새 기록도 보존해야 합니다. 옛 rollback 파일이 현재 모든 후속 migration에 맞는다고 가정하지 않습니다.

## 검사 구분

| 범위 | 실행과 주의점 |
| --- | --- |
| 합성 회귀 | `bun run test:unit`. 공개 코드의 기본 검증 |
| PostgreSQL | 폐기 가능한 로컬 DB에 설치 후 `community-guide-pg`, `community-guide-security-pg`, `membership-reminder-audit-pg`, `community-storage`, `community-scheduler`, `normalized-legacy`, `default-reminders`, `community-bug-storage`, `community-bug-delivery`, `community-bug-expiry-job-guard`, `bug-db-integrity-contract.sql`, `bug-team-scope-contract.sql`, `bug-private-atomic-contract.sql`, `community-bug-private-backfill`, `current-member-reminders.sql` 검사 실행. guide 검사는 009 운영 상태와 001–028 신규 설치를 모두 순차 이관함 |
| 실제 서비스 | 명시한 채널·회원·날짜만 검증. 전후 기록, 실제 게시, 실패 범위를 별도 보존 |

DB 검사의 `COMMUNITY_PG_SOCKET`, `COMMUNITY_PG_PORT`, `COMMUNITY_PG_DATABASE`를 확인합니다. 기본값이 검사마다 다를 수 있으므로 DB 이름을 명시합니다. `*-live*`, backfill, fixture 복원, migration 스크립트를 일반 테스트에 섞지 않습니다.

## 버그 제보 기반 검증과 후속 연결

`community-bugs`, `community-bug-dialogue`, `community-bug-due-store`, `community-bug-backlog`, `community-clock`, `community-admin-collection`은 합성 회귀 allowlist에 포함됩니다. mock Slack delivery의 failed → retry → sent, 응답이 사라진 DB 커밋 복구, 전역 시계의 정확한 due·activity 예약, 단계별 10건 배치의 5분 후속 실행, 빈 상태 한 시간 안전 검사와 일반 채널 스케줄 격리를 검증합니다. `qa/community-bug-storage.mjs`는 새 폐기 가능한 PostgreSQL 인스턴스에 migration 014–022를 적용하고 DB 무결성·팀 격리·비공개 원자 커밋·신규 설치 무변경 backfill·원문 없는 incoming marker·소유자 범위 암호화 객체 복원 정보를 확인합니다. `qa/community-bug-private-backfill.mjs`는 017 상태의 오염 fixture를 만든 뒤 018–021 upgrade가 opaque lineage와 event를 보존하면서 관계형 canary를 제거하고 outbox를 한 번만 보정하는지 검증합니다. `qa/community-bug-delivery.mjs`와 `qa/community-bug-expiry-job-guard.mjs`는 각각 delivery와 원자적 만료·job guard 경계를 확인합니다. 이 PostgreSQL 검사들은 일반 `check`에 넣지 않습니다. `qa/maintainer-dry-run.mjs`는 Git 작업본과 임시 디렉터리가 필요하며, 확정된 fixture로 provider-neutral 무변경 handoff만 검사합니다.

```sh
bun qa/community-bug-storage.mjs
bun qa/community-bug-delivery.mjs
bun qa/community-bug-expiry-job-guard.mjs
bun qa/community-bug-private-backfill.mjs
bun qa/community-bug-slack-validator.mjs
bun qa/maintainer-dry-run.mjs
node scripts/maintainer-dry-run.mjs --input qa/fixtures/bug-packets/confirmed-valid.v1.json --output "local-proof-$(uuidgen)"
```

`community-bug-slack-validator`는 인증 없이 Slack의 side-effect-free `blocks.validate`만 호출하는 명시적 네트워크 계약 검사입니다. 일반 단위 테스트 allowlist에는 넣지 않으며, 네트워크 장애를 제품 회귀로 오판하지 않습니다.

마지막 명령은 도구가 소유한 비공개 임시 경로의 새 직접 자식만 받아 `bug_packet.v1`의 digest, base SHA, dirty 상태를 영수증으로 남깁니다. `automation/runner/genquant-runner.mjs`만 최소 권한 `otl_bug_runner` 역할로 승인된 reproduce·fix job을 lease하고 Codex Cloud CLI를 호출할 수 있습니다. 재현 diff는 단일 schema artifact로 제한하고, 수정 diff는 금지 경로 검사와 전체 `bun run check`를 통과해야 합니다. 그 뒤에만 격리 브랜치, Draft PR, 보호된 `main`의 squash merge를 수행합니다. GitHub Actions workflow는 만들지 않습니다.

## Git과 공개 코드

코드·직접 관련 테스트·명세를 함께 커밋하고 첫 줄에는 변경 목적을 씁니다. 필요한 `Constraint`, `Rejected`, `Tested`, `Not-tested` trailer로 결정과 검증 한계를 남깁니다. 제품 버전과 migration 번호는 별개입니다.

운영 이력이 있는 로컬 저장소는 공개 원격에 `--all`이나 `--mirror`로 push하지 않습니다. 공개 설정 예시·합성 테스트만 별도 작업본에 반영하고 staged 정보 검사와 `check`를 거쳐 push합니다. API 키·회원 원문·덤프·`.omx` 영수증은 제외합니다.

`export-public.mjs`가 있는 운영 저장소에서는 공개용 스냅샷을 생성할 수 있습니다. 기존 공개 Git 이력이 있는 경로를 덮어쓰지 않도록 보호되어 있습니다. migration 014–023, 버그 ledger·delivery·만료·무결성 QA fixture와 계약 SQL, 전역 시계 코드와 `automation/`의 공개 스키마·dry-run runner를 포함하지만 운영 식별자, 실제 제보 원문, `.omx`, credential은 포함하지 않습니다. 공개용 문서 원본은 이 문서 묶음이며, 내보내기 스크립트에 별도 사용법을 복제하지 않습니다.

```sh
node scripts/export-public.mjs /tmp/otl1-public-review
cd /tmp/otl1-public-review && bun run check
```

버그 질문 Block Kit을 Slack 계약과 직접 대조할 때는 `bun qa/community-bug-slack-validator.mjs`를 별도로 실행합니다. 이 검사는 인증·게시 없이 `blocks.validate`만 호출하며 외부 네트워크 검사이므로 일반 `check`에는 포함하지 않습니다.

스냅샷은 Git 이력이 없는 경로이므로 Git 작업본이 필요한 maintainer dry-run QA는 `check` allowlist에서 제외합니다. 공개 clone에서 그 QA를 실행할 때는 별도 Git 작업본을 만들고 임시 출력 경로를 사용합니다.

데이터 모델은 [시스템 구조](ARCHITECTURE.md), 서비스 사용법은 [사용 가이드](USER_GUIDE.md)를 따릅니다.

## 자연어 대상 날짜 회귀 검사

대상 날짜는 메시지 맨 앞의 날짜 헤더나 기록 대상 표현에서만 결정합니다. 본문 속 교재 장 번호, 시각, URL, 버전, 백분율과 이유에 포함된 과거 표현은 목표·후기 내용으로 유지합니다. 다른 날짜의 기록 변경과 여러 대상 날짜는 기존 확인·거절 경계를 유지합니다.

`bun qa/community-target-date.mjs`는 순수 판별과 Qwen 호출 경계를, `bun qa/community-target-date-routing.mjs`는 서명된 합성 Slack 이벤트의 저장·부분 후기·재전송 멱등성을 검사합니다. 두 검사는 실제 Slack이나 Neon을 호출하지 않습니다.

## 즉시 Slack 참여 로컬 검증

`SLACK_SHARED_INVITE_URL`은 Site Worker secret 이름으로만 선언하고 값은 저장소에 기록하지 않습니다. 로컬 QA는 합성 `join.slack.com` URL과 fake Core를 사용하며 외부 Slack으로 이동하거나 가입을 만들지 않습니다. migration 042, `qa/referral-direct-join.mjs`, `qa/site-direct-join.mjs`, `qa/instant-shared-invite-pg.mjs`와 release rehearsal이 모두 통과한 뒤에도 운영 migration·secret 설치·플래그 활성화·실제 `team_join` 관찰은 별도 단계입니다. 공유 링크는 방문자에게 최종 노출될 수 있으므로 유출 시 두 referral flag를 닫고 Slack에서 링크를 회수·교체합니다.

### GenQuant 조건부 자동 배포

승인자가 정확한 SHA를 승인하면 `otl1-bug-deployer.timer`가 병합된 SHA를 DB lease로 가져옵니다. `automation/runner/change-policy.mjs`가 변경 경로 전체를 다시 분류하고, 현재 checkout이 승인 SHA의 정확한 조상일 때만 fast-forward합니다.

- `event-site/**`와 이벤트 시간표 allowlist는 `open-events` adapter로 `otl1-time`을 배포합니다.
- `src/**`, 루트 Worker 설정·검사 경로는 `core-worker` adapter로 분류하며 Founder 승인 뒤 `otl1-onething-garden`을 배포합니다.
- runner·운영 파일만 바뀐 경우 runner 계약 검사와 systemd 서비스 재시작을 수행합니다.
- migration과 일반 site가 섞인 Core 변경은 Founder가 정확한 SHA를 승인한 경우에만 GenQuant Broker가 전용 migration 역할로 forward migration을 적용한 뒤 Core Worker와 site를 순서대로 배포하고 각각 readback합니다. 승인 범위 밖의 migration 파일, 끊긴 선행 migration, 전용 역할·대상 config가 없는 경우에는 fail-closed합니다.

각 adapter는 전체 `bun run check`, exact HEAD, Worker version과 `/health`를 확인한 뒤에만 `bug_runner_finish_deployment` 영수증을 기록합니다. 진행 중인 leased job이 있으면 deployment claim 자체를 보류합니다. 공개 fork에서 직접 연 PR은 자동 큐에 들어오지 않으며, 현재는 `#po-work`에서 Founder가 피드백 항목과 head SHA에 연결해야 합니다.
