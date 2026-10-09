import type { CommunityEnv } from "./community-runtime";
import { callSlack } from "./community-social";
import { InputError, object, string } from "./input";

export const MAINTAINER_CANVAS_VERSION = "v0.5.0";

type CanvasEnv = Pick<
  CommunityEnv,
  | "SLACK_BOT_TOKEN"
  | "COMMUNITY_MAINTAINERS_CHANNEL_ID"
  | "COMMUNITY_MAINTAINER_WORKSTREAM_CHANNEL_IDS"
  | "COMMUNITY_FEEDBACK_CHANNEL_ID"
  | "COMMUNITY_RELEASE_CHANNEL_ID"
  | "COMMUNITY_SYS_ALERT_CHANNEL_ID"
> & { readonly PO_DEVELOPMENT_DIAGRAM_URL?: string };

export type MaintainerCanvasDefinition = {
  readonly key: "main" | "build" | "design" | "community";
  readonly channelId: string;
  readonly title: string;
  readonly topic: string;
  readonly purpose: string;
  readonly markdown: string;
};

function mention(channelId: string | undefined, fallback: string): string {
  return channelId ? `![](#${channelId})` : fallback;
}

export function maintainerCanvasDefinitions(env: CanvasEnv): readonly MaintainerCanvasDefinition[] {
  const main = env.COMMUNITY_MAINTAINERS_CHANNEL_ID;
  const workstreams = env.COMMUNITY_MAINTAINER_WORKSTREAM_CHANNEL_IDS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!main || !workstreams || workstreams.length < 3)
    throw new InputError("PO Canvas 채널을 확인해 주세요.");
  const [build, design, community] = workstreams;
  if (!build || !design || !community) throw new InputError("PO Canvas 채널을 확인해 주세요.");
  const workLink = mention(main, "#po-work");
  const feedbackLink = mention(env.COMMUNITY_FEEDBACK_CHANNEL_ID, "#all-freetalk-qna-feedback");
  const eventLink = mention(env.COMMUNITY_RELEASE_CHANNEL_ID, "#all-townhall-events");
  const alertLink = mention(env.COMMUNITY_SYS_ALERT_CHANNEL_ID, "#po-sys-alert");
  return [
    {
      key: "main",
      channelId: main,
      title: "OT1L Product Owner · 같이 만들며 배우기",
      topic: "제안·DRI·협업·승인·배포를 한곳에서 보고 같이 만들며 배우기",
      purpose:
        "모든 PO 작업의 정본입니다. 아이디어를 제안하고, DRI를 맡거나 넘기고, AI·동료와 만든 결과를 확인합니다.",
      markdown: `# OT1L Product Owner · 같이 만들며 배우기
> 이곳은 Product Owner 작업의 정본입니다. 아이디어와 질문은 PO 라운지에서 나누고, 실행하기로 한 일은 카드와 스레드로 관리합니다. Product Owner는 코딩 여부와 관계없이 회원 문제를 실제 변화로 만들고 그 과정에서 배우는 참여 방식입니다.

## 여기서 얻는 것
- 내 제안이 실제 기능·모임·안내로 반영되는 전 과정을 경험합니다.
- 개발환경이 없어도 AI와 함께 수정안을 만들고, 원하면 내 환경에서 직접 이어갈 수 있습니다.
- DRI를 맡아 작은 일을 끝내거나 다른 PO에게 넘기며 협업을 배웁니다.
- QA, 글쓰기, 디자인, 진행, 질문 정리도 기여로 남습니다. 코딩은 필수가 아닙니다.
- Q&A, 허들, 첫 기여 OT를 요청하거나 직접 열 수 있습니다.

## 오늘 바로 참여하기
1. 채널 상단의 **피드백·AI 수정 요청**에서 불편함, 아이디어, 배우고 싶은 일 중 하나를 남깁니다.
2. 직접 해보고 싶으면 DRI를 맡고, 같이 하고 싶으면 스레드에서 동료를 찾습니다.
3. AI가 만든 수정안이든 사람이 만든 수정안이든 실제 화면과 동작을 확인한 뒤 승인합니다.
4. 끝나면 무엇이 달라졌고 무엇을 배웠는지 스레드에 한 줄 남깁니다.

## 두 가지 작업 방법
- **AI에게 맡기기**: 문제와 원하는 결과를 적으면 GenQuant의 Codex가 수정·검사·PR 생성을 맡습니다. PR을 직접 연결하지 말고 결과와 승인 버튼을 기다리세요. 원하는 결과를 비워 두면 의견만 접수됩니다.
- **직접 개발하기**: 본인 개발환경이나 본인 AI로 코드를 고친 뒤 GitHub PR을 만들었을 때만 **직접 만든 PR 검토 요청**을 사용합니다. PR은 코드 수정안을 검토해 달라는 요청입니다.
- 같은 작업에 두 실행 경로를 동시에 요청하지 않습니다. Draft PR은 검토용이며 병합하지 않습니다.

## PO 권한
지정된 PO 채널에 참여한 사람 회원은 PO입니다. 가입 이벤트와 정기 점검으로 권한을 맞추고, 병합 승인 직전에 다시 확인합니다. 모든 PO 채널을 떠나면 권한이 해제됩니다. sys-alert만 가입한 사람, 봇, 탈퇴 계정, 명시적으로 권한이 회수된 계정은 제외합니다.

## 공간 고르기
- ${mention(community, "#po-freetalk-anything")}: 아이디어·질문·사용자 경험을 이야기하는 PO 라운지
- ${mention(build, "#po-dev")}: AI와 함께 실제 기능을 만들며 배우는 빌드 스튜디오
- ${mention(design, "#po-design")}: 화면·콘텐츠·접근성을 함께 만드는 디자인 스튜디오
- ${feedbackLink}: 모든 회원의 피드백이 시작되는 곳
- ${eventLink}: 누구나 활동을 제안하고 열 수 있는 곳
- ${alertLink}: 운영 장애와 배포 실패를 확인하는 곳

## 역할은 둘로 나눕니다
- **DRI**: 결과를 확인하고 다음 사람에게 설명할 책임이 있는 사람
- **실행자**: 직접 개발하는 사람 또는 구현을 돕는 OT1L Bot/Codex

AI가 실행해도 사람 DRI가 사라지지 않습니다. token, DB 주소, SSH key 같은 비밀은 Slack에 올리지 않습니다.

_${MAINTAINER_CANVAS_VERSION}_`,
    },
    {
      key: "build",
      channelId: build,
      title: "PO 개발실 · AI와 함께 만들기",
      topic: "AI에게 맡기기 또는 직접 개발하기 · 재현·구현·QA · 승인과 진행 기록은 po-work",
      purpose:
        "PO가 AI·동료와 실제 기능을 만들고 배우는 개발실입니다. 개발환경이 없어도 재현·QA로 참여하며, 작업의 담당자와 승인은 po-work에서 관리합니다.",
      markdown: `# PO 개발실 · AI와 함께 만들기
> 봇 작업 보관함이 아니라, PO가 AI·동료와 실제 기능을 만들어 보며 배우는 공간입니다. Product Owner(PO)는 회원 문제를 찾아 개선을 끝까지 맡는 사람이며 코딩 실력과 무관합니다.

## 먼저 읽기: 무엇을 누르면 되나요?
- **코드를 직접 쓰지 않을 때**: ${workLink}의 **피드백·AI 수정 요청**. GenQuant의 Codex가 수정·검사·PR 생성을 맡습니다. PR을 직접 연결할 필요가 없습니다.
- **이미 직접 코드를 고쳤을 때**: 본인 개발환경 또는 본인 AI로 GitHub PR을 만든 다음 **직접 만든 PR 검토 요청**. PR 주소만 넣으면 됩니다.
- **아직 방향을 이야기하고 싶을 때**: PO 라운지에서 논의하거나 원하는 결과를 비워 의견만 접수하세요. 두 칸을 채우면 AI 작업이 시작되므로 구현을 원할 때 사용합니다.
- PR(Pull Request)은 코드 수정안을 검토해 달라는 요청입니다. DRI는 다음 행동과 결과를 챙기는 담당자입니다. 본인이 제안한 작업은 기본 담당자가 본인이며 카드에서 다른 PO로 바꿀 수 있습니다.

## 한눈에 보는 작업 흐름
${env.PO_DEVELOPMENT_DIAGRAM_URL ? `![](${env.PO_DEVELOPMENT_DIAGRAM_URL})` : "[Mermaid 작업 흐름 보기](https://github.com/Betalgeuse/ot1l/blob/main/docs/PO_DEVELOPMENT.md#작업-흐름)"}

[수정 가능한 Mermaid 원본과 개발 안내](https://github.com/Betalgeuse/ot1l/blob/main/docs/PO_DEVELOPMENT.md)

## A. 개발환경 없이 AI에게 맡기기
1. 기존 작업이 있는지 ${workLink}에서 검색합니다. 이미 진행 중이면 그 스레드에 관찰 결과를 보탭니다.
2. **피드백·AI 수정 요청**에 지금 불편한 점과 원하는 결과를 적습니다. 예: “30분 단위 시간이 보이지 않아요 → 11:00, 11:30을 선택할 수 있게 해주세요.”
3. 봇이 접수한 같은 스레드에서 수정안·검증 결과를 기다립니다. GenQuant는 실행 서버이고 Codex는 수정하는 AI입니다. 별도 가입이나 SSH 접속은 필요 없습니다.
4. 결과가 나오면 바뀐 부분과 실제 화면을 확인합니다. 재현 방법, 기대 결과, 실패 사례를 댓글로 남깁니다.
5. 검증된 Open 변경은 **Product Owner 병합·배포 승인**, 보호 영역은 **Founder 병합·배포 승인**을 사용합니다. 승인 전에는 운영에 반영되지 않습니다.
6. 승인 후 Broker가 병합·배포합니다. 병합됨, 배포됨, 실제 사용 확인은 다른 단계입니다. 마지막으로 원래 불편이 사라졌는지 확인합니다.

## B. 내 개발환경이나 내 AI로 직접 개발하기
1. 공개 저장소를 본인 GitHub 계정으로 fork합니다. 로컬 clone 후 AGENTS.md와 CONTRIBUTING.md를 먼저 읽습니다.
2. 새 브랜치에서 작은 변경 하나를 만듭니다. 설치는 bun install --frozen-lockfile, 전체 검사는 bun run check입니다. DB 변경은 임시 PostgreSQL 검사도 필요합니다.
3. 일반 회원과 PO 화면, 오류·중복 클릭 같은 실패 상황을 직접 QA합니다. 코드 검사만 통과했다고 화면까지 확인된 것은 아닙니다.
4. 본인 fork에 push하고 Betalgeuse/ot1l의 main을 대상으로 PR을 엽니다. 시안 논의만 하려면 Draft로 둡니다.
5. 원래 작업 카드의 **직접 만든 PR 검토 요청**에 PR 주소를 넣습니다. 카드에서 열면 그 작업이 자동 선택됩니다.
6. Broker가 정확한 커밋 SHA를 별도 환경에서 다시 검사합니다. Draft는 검토용이며 병합 승인 대상이 아닙니다.
7. 같은 스레드에서 검토·승인합니다. 승인 뒤 새 커밋이 생기면 다시 검증하고 최신 SHA를 승인해야 합니다.

## 어느 폴더를 고칠까요?
- event-site/src, site/dist/event-schedule.*: 이벤트 시간 선택 화면과 전용 Worker otl1-time.
- site/dist/index.html, site/dist/styles.css, site/dist/assets: 홈페이지·공용 디자인. 공용 CSS는 홈페이지와 이벤트 화면 모두 확인합니다.
- src/slack-presentation: 실행 로직 없는 Slack 표시 데이터. 정해진 경계 검사를 통과해야 PO 승인 대상입니다.
- src의 일반 로직, migrations: Slack 처리·DB·회원 상태 등 운영 권한을 사용하는 영역입니다. 현재 보호 영역으로 검토합니다.
- automation/runner: 검증·병합·배포기입니다. 운영 키와 서버 권한 때문에 보호합니다.
- qa, docs: 회귀 검사와 사용 안내입니다. 폴더만 보고 승인 범위를 추측하지 말고 CONTRIBUTING.md와 실행 가능한 change-policy 기준을 확인합니다.

## 승인 전 QA 체크리스트
- [ ] 문제를 재현했고, 수정 후 같은 순서에서 해결됐나요?
- [ ] 일반 회원 / PO / Founder의 버튼과 권한이 맞나요?
- [ ] 모바일·브라우저에서 필요한 버튼과 안내가 실제 보이나요?
- [ ] 빈 입력, 뒤로 가기, 반복 클릭, 오래된 버튼, API 실패를 확인했나요?
- [ ] 같은 작업 스레드를 유지하고 공개 채널에 중복 알림이 생기지 않나요?
- [ ] 테스트한 SHA와 승인할 SHA가 같고, 배포 뒤 확인할 항목을 적었나요?

## 막히면 이렇게 남겨 주세요
- 화면 문제: 어느 화면인지 + 재현 순서 + 기대 결과 + 개인정보를 가린 캡처.
- 검사 실패: 실패한 명령과 비밀값을 지운 오류 요약. 같은 PR을 수정한 뒤 재검증합니다.
- 이미 AI가 작업 중: 직접 PR을 동시에 연결하지 말고 같은 스레드에서 담당자와 실행 경로를 정합니다.
- 배포 실패: 승인 버튼을 반복 누르지 말고 ${alertLink}의 해당 오류와 원래 작업 스레드를 연결합니다. 운영 완료라고 표시하지 않습니다.
- 도움이 필요하면 전문 그룹 설정과 @po 부르기, Q&A 허들·첫 기여 OT 요청을 이용하세요.

## 내 AI에게 전달할 문장
“AGENTS.md와 CONTRIBUTING.md를 먼저 읽고, 요청한 변경의 소유 영역과 승인 범위를 확인해줘. 내 fork의 새 브랜치에서 구현과 bun run check, 실제 UI QA를 진행한 뒤 PR 링크와 확인하지 못한 항목을 알려줘. 운영 비밀을 요청하거나 로컬에서 배포하지 마.”

## 보안과 작업 기록
운영 Slack·DB·Cloudflare·SSH 키는 개발에 필요하지 않습니다. .dev.vars, 운영 설정, 개인정보, 원본 로그를 PR이나 AI 프롬프트에 붙이지 마세요. 개인 컴퓨터에서 운영 배포하지 않으며 승인 후 Broker가 실행합니다. 이 채널은 작업 과정과 질문을 나누는 곳이고, DRI·승인·진행 기록은 ${workLink}의 원래 카드에 남깁니다.

작업의 DRI·승인·배포 상태는 ${workLink} 카드 한 곳에서 관리합니다. 이 채널에는 과정, 질문, 초안과 배움을 남깁니다.

_${MAINTAINER_CANVAS_VERSION}_`,
    },
    {
      key: "design",
      channelId: design,
      title: "PO 디자인실 · 보이는 경험 만들기",
      topic: "화면·콘텐츠·정보 구조·접근성을 함께 관찰하고 만들기",
      purpose:
        "코딩 없이도 실제 회원 경험을 관찰하고 시안·카피·접근성·브라우저 QA를 제품에 반영하는 디자인 스튜디오입니다.",
      markdown: `# PO 디자인실 · 보이는 경험 만들기
> 코딩하지 않아도 OT1L의 화면, 말투, 정보 구조와 접근성을 바꿀 수 있습니다.

## 여기서 얻는 것
- 실제 회원이 쓰는 화면을 관찰하고 문제를 정의하는 경험
- Figma·문구·정보 구조·접근성 피드백을 실제 제품에 반영하는 경험
- 동료의 시안을 함께 보고 설명·비평하는 경험
- 내가 기여한 전후 화면과 판단을 포트폴리오로 남길 수 있는 결과

## 참여 방법
1. 불편한 화면이나 이해하기 어려운 문장을 캡처·링크와 함께 올립니다.
2. “누구에게, 어떤 순간에, 무엇이 쉬워져야 하는가”를 한 줄 적습니다.
3. 시안, 카피, 접근성 점검, 브라우저 QA 중 하나만 맡아도 됩니다.
4. 구현할 작업은 ${workLink}에 연결해 DRI와 상태를 한 곳에서 봅니다.

## 함께 보기 좋은 주제
- 처음 온 회원이 다음 행동을 바로 이해하는가
- 모바일에서도 버튼과 중요한 상태가 보이는가
- 긴 설명 없이도 참여의 효용이 느껴지는가
- 키보드와 스크린리더로도 사용할 수 있는가

## 시안을 작업으로 넘길 때
- 현재 화면, 대상 사용자, 바뀐 화면, 기대하는 행동을 함께 보여 주세요. Figma는 선택 사항이며 캡처나 손그림도 괜찮습니다.
- 같은 스레드에서 채택할 안과 아직 결정하지 않은 점을 나눠 적습니다. 시안이 있다는 것과 운영에 적용됐다는 것은 다릅니다.
- AI 구현은 **피드백·AI 수정 요청**, 이미 코드로 만든 PR은 **직접 만든 PR 검토 요청**을 사용합니다. Draft PR은 의견을 받는 용도입니다.
- 반영 후 모바일·빈 상태·오류 상태·명암 대비·버튼 이름을 확인하고 결과를 ${workLink}에 남깁니다.

_${MAINTAINER_CANVAS_VERSION}_`,
    },
    {
      key: "community",
      channelId: community,
      title: "PO 라운지 · 질문과 모임 연결하기",
      topic: "질문·Q&A·첫 기여 OT·모임으로 사람과 참여 연결하기",
      purpose:
        "회원을 돕고 Q&A·허들·첫 기여 OT를 열며 관심사를 이벤트와 챕터로 연결하는 커뮤니티 스튜디오입니다.",
      markdown: `# PO 라운지 · 질문과 모임 연결하기
> retention 숫자를 관리하는 곳이 아니라, 회원이 환영받고 도움받고 다시 참여하고 싶도록 사람과 경험을 연결하는 공간입니다.

## 여기서 얻는 것
- 신규 회원의 첫 경험을 관찰하고 더 편하게 만드는 경험
- 질문에 답하고, Q&A·허들·첫 기여 OT를 직접 열어 보는 진행 경험
- 관심사를 발견해 이벤트나 챕터로 연결하는 커뮤니티 빌딩 경험
- 혼자 하기 어려운 기여를 다른 PO와 함께 시작하는 관계

## 지금 할 수 있는 것
- 상단 고정 안내에서 **질문 남기기**, **Q&A 허들 요청**, **첫 기여 OT 요청**을 누릅니다.
- 도움 요청이 올라오면 **제가 도울게요**를 눌러 스레드에서 방법과 시간을 맞춥니다.
- welcome 안내에서 막히는 지점이나 새 회원의 질문을 발견하면 ${workLink}에 개선 작업으로 연결합니다.
- 함께 해보고 싶은 활동은 ${eventLink}에서 누구나 열거나 수요를 확인합니다.

## 좋은 참여의 기준
- 대신 결정하기보다 다음 선택지를 이해하게 돕습니다.
- 개인정보와 가입 권한은 공개 스레드에 복사하지 않습니다.
- 한 번의 행사보다 다음 참여가 쉬워졌는지를 함께 돌아봅니다.

## 대화와 실행 구분하기
- 아이디어·잡담·사용 경험은 여기서 편하게 나눕니다. 대화마다 개발 작업을 만들 필요는 없습니다.
- 실행할 일이 정해지면 ${workLink}의 작업 카드 하나로 연결하고 DRI를 정합니다.
- 원하는 결과가 아직 미정이면 의견만 접수합니다. 자동 수정을 시작하고 싶을 때 문제와 원하는 결과를 함께 적습니다.
- PO 채널의 사람 회원은 PO 권한과 연결됩니다. 코딩 경험은 조건이 아니며, sys-alert만 가입한 경우는 제외합니다.

_${MAINTAINER_CANVAS_VERSION}_`,
    },
  ];
}

function channelCanvasId(info: Record<string, unknown>): string | null {
  const channel = object(info.channel);
  const properties = channel.properties;
  if (typeof properties !== "object" || properties === null || Array.isArray(properties))
    return null;
  const tabs = object(properties).tabs;
  if (Array.isArray(tabs))
    for (const tab of tabs) {
      const item = object(tab);
      if (item.type !== "canvas" || typeof item.data !== "object" || item.data === null) continue;
      const id = object(item.data).file_id;
      if (typeof id === "string" && id) return id;
    }
  const canvas = object(properties).canvas;
  if (typeof canvas !== "object" || canvas === null || Array.isArray(canvas)) return null;
  const value = object(canvas).file_id ?? object(canvas).id;
  return typeof value === "string" && value ? value : null;
}

export async function publishMaintainerCanvases(
  env: CanvasEnv,
): Promise<
  readonly { readonly key: string; readonly channelId: string; readonly canvasId: string }[]
> {
  if (!env.PO_DEVELOPMENT_DIAGRAM_URL || !/^https:\/\//.test(env.PO_DEVELOPMENT_DIAGRAM_URL))
    throw new InputError("개발 흐름도 이미지 URL을 지정해야 기존 Canvas 그림을 보존할 수 있어요.");
  const receipts = [];
  for (const definition of maintainerCanvasDefinitions(env)) {
    await callSlack(env.SLACK_BOT_TOKEN, "conversations.setTopic", {
      channel: definition.channelId,
      topic: definition.topic,
    });
    await callSlack(env.SLACK_BOT_TOKEN, "conversations.setPurpose", {
      channel: definition.channelId,
      purpose: definition.purpose,
    });
    const info = await callSlack(env.SLACK_BOT_TOKEN, "conversations.info", {
      channel: definition.channelId,
    });
    const existing = channelCanvasId(info);
    const documentContent = {
      type: "markdown",
      // Canvas already renders its title; avoid a second identical H1.
      markdown: definition.markdown.replace(/^# [^\n]+\n/, ""),
    } as const;
    let canvasId: string;
    if (existing) {
      canvasId = existing;
      await callSlack(env.SLACK_BOT_TOKEN, "canvases.edit", {
        canvas_id: existing,
        changes: [{ operation: "replace", document_content: documentContent }],
      });
    } else {
      const created = await callSlack(env.SLACK_BOT_TOKEN, "conversations.canvases.create", {
        channel_id: definition.channelId,
        title: definition.title,
        document_content: documentContent,
      });
      canvasId = string(created.canvas_id);
    }
    // The first heading does not rename the Canvas or its channel tab.
    // Slack accepts exactly one Canvas edit operation per API call.
    await callSlack(env.SLACK_BOT_TOKEN, "canvases.edit", {
      canvas_id: canvasId,
      changes: [
        { operation: "rename", title_content: { type: "markdown", markdown: definition.title } },
      ],
    });
    receipts.push({ key: definition.key, channelId: definition.channelId, canvasId });
  }
  return receipts;
}
