# OT1L · ONE THING 1 LINE

오늘 가장 중요한 일 하나를 한 문장으로 정하고, 실행하고, 돌아보는 Slack 기반 커뮤니티입니다. 봇의 목적은 기록량을 늘리는 것이 아니라 회원이 실제로 중요한 일을 해내고 서로 돕기 쉽게 만드는 것입니다.

## 시작하기

- 회원: [사용 가이드](docs/USER_GUIDE.md)
- 이벤트 주최자·참가자: [Townhall 이벤트](docs/EVENTS.md)
- Maintainer: [Maintainer 작업 흐름](docs/MAINTAINER_WORKFLOW.md)
- 공개 Contributor: [기여 시작하기](CONTRIBUTING.md)
- 운영자: [운영 가이드](docs/OPERATIONS.md)
- 개발자: [개발 가이드](docs/DEVELOPMENT.md)

전체 문서의 권위와 상태 구분은 [문서 안내](docs/README.md)를 먼저 확인하세요. 정적 문서는 작업 진행률을 나타내지 않습니다. 현재 작업 단계는 Slack `#maintainers`와 홈페이지 `/maintainers`의 OT1L DB 투영에서 확인합니다.

## 저장소 구조

| 경로 | 책임 | 변경 권한 |
| --- | --- | --- |
| `src/` | Slack 상호작용, 회원 상태, 이벤트 lifecycle, DB 접근을 포함한 Core Worker | Core |
| `migrations/` | 순방향 PostgreSQL schema와 권한 계약 | Core |
| `event-site/`와 이벤트 시간표 allowlist | 비밀 없는 공개 이벤트 시간표 Worker | Open |
| `site/`의 allowlist 밖 경로 | 가입·공개 홈페이지·Maintainer 현황 페이지 | Core |
| `automation/runner/` | 변경 분류, Codex 작업, 승인된 병합·배포 Broker | Core |
| `ops/genquant/` | Broker의 systemd 운영 파일과 비밀 없는 예시 설정 | Core |
| `qa/` | 외부 변경을 만들지 않는 합성 회귀와 명시적 별도 통합 검사 | 변경 경로에 따름 |
| `scripts/` | 빌드·검사·제한된 운영 도구 | Core |
| `docs/` | 현재 계약·운영 절차·역사·조사 자료 | Core 검토 |

`node_modules/`, `.output/`, `.wrangler/`, `.dev.vars`, `error.log`, `bugs/`는 로컬 생성물 또는 비공개 작업 영역이며 소스가 아닙니다. 운영 비밀, 회원 원문, 로그 원문을 저장소에 넣지 않습니다.

실제 경로 분류의 실행 원본은 `automation/runner/change-policy.mjs`입니다. 설명과 코드가 다르면 배포를 멈추고 코드·문서·회귀 검사를 같은 변경에서 맞춥니다.

```sh
bun install --frozen-lockfile
bun run check
```

공개 저장소: https://github.com/Betalgeuse/ot1l
