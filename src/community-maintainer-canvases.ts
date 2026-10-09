import type { CommunityEnv } from "./community-runtime";
import { callSlack } from "./community-social";
import { InputError, object, string } from "./input";

export const MAINTAINER_CANVAS_VERSION = "v0.1.0";

type CanvasEnv = Pick<
  CommunityEnv,
  | "SLACK_BOT_TOKEN"
  | "COMMUNITY_MAINTAINERS_CHANNEL_ID"
  | "COMMUNITY_MAINTAINER_WORKSTREAM_CHANNEL_IDS"
  | "COMMUNITY_FEEDBACK_CHANNEL_ID"
  | "COMMUNITY_RELEASE_CHANNEL_ID"
  | "COMMUNITY_SYS_ALERT_CHANNEL_ID"
>;

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
> Product Owner는 운영 권한만 받는 역할이 아닙니다. 내가 불편했던 점이나 해보고 싶은 일을 사람들과 실제 변화로 만들고, 그 과정에서 배우는 참여 방식입니다.

## 여기서 얻는 것
- 내 제안이 실제 기능·모임·안내로 반영되는 전 과정을 경험합니다.
- 개발환경이 없어도 AI와 함께 수정안을 만들고, 원하면 내 환경에서 직접 이어갈 수 있습니다.
- DRI를 맡아 작은 일을 끝내거나 다른 PO에게 넘기며 협업을 배웁니다.
- QA, 글쓰기, 디자인, 진행, 질문 정리도 기여로 남습니다. 코딩은 필수가 아닙니다.
- Q&A, 허들, 첫 기여 OT를 요청하거나 직접 열 수 있습니다.

## 오늘 바로 참여하기
1. 채널 상단의 **피드백·작업 제안**에서 불편함, 아이디어, 배우고 싶은 일 중 하나를 남깁니다.
2. 직접 해보고 싶으면 DRI를 맡고, 같이 하고 싶으면 스레드에서 동료를 찾습니다.
3. AI가 만든 수정안이든 사람이 만든 수정안이든 실제 화면과 동작을 확인한 뒤 승인합니다.
4. 끝나면 무엇이 달라졌고 무엇을 배웠는지 스레드에 한 줄 남깁니다.

## 공간 고르기
- ${mention(build, "#po-dev")}: AI와 함께 실제 기능을 만들며 배우는 빌드 스튜디오
- ${mention(design, "#po-design")}: 화면·콘텐츠·접근성을 함께 만드는 디자인 스튜디오
- ${mention(community, "#po-freetalk-anything")}: 사람을 돕고 Q&A·OT·모임을 운영하는 커뮤니티 스튜디오
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
      title: "Maintainer Build Studio · 만들면서 배우기",
      topic: "AI·동료와 만들며 배우기 · 재현·QA·문구·코드·페어 작업",
      purpose:
        "개발환경이 없어도 실제 OT1L 기능을 함께 만들고 배우는 Maintainer Build Studio입니다. 봇 상태가 아니라 사람의 질문·과정·초안·배움을 나눕니다.",
      markdown: `# Maintainer Build Studio · 만들면서 배우기
> 봇 작업 보관함이 아니라, Maintainer가 AI·동료와 실제 기능을 만들어 보며 배우는 공간입니다.

## 여기서 얻는 것
- 개발환경 없이도 재현, 요구사항, QA부터 기여를 시작할 수 있습니다.
- 원하면 공개 저장소를 fork해 원하는 AI 개발 도구나 로컬 환경에서 직접 수정합니다.
- 작은 PR, 코드 리뷰, 브라우저 QA, 문서 개선을 실제 배포까지 연결해 봅니다.
- 막히면 혼자 해결하지 않고 페어 작업이나 허들을 요청합니다.

## 첫 15분
1. ${workLink}에서 관심 있는 작업 카드 하나를 고릅니다.
2. 스레드에 “재현”, “QA”, “문구”, “코드” 중 맡고 싶은 부분을 적습니다.
3. AI에게 맡길 부분과 내가 확인할 부분을 나눕니다.
4. 동작을 직접 확인하고 결과를 원래 작업 스레드에 연결합니다.

## 좋은 기여 예시
- 버그를 다시 재현할 수 있는 짧은 순서
- 모바일·일반 회원 계정에서 발견한 UI 차이
- 이해하기 어려운 안내를 더 쉬운 문장으로 바꾸기
- 테스트 하나, 작은 코드 수정 하나, 리뷰 의견 하나

작업의 DRI·승인·배포 상태는 ${workLink} 카드 한 곳에서 관리합니다. 이 채널에는 과정, 질문, 초안과 배움을 남깁니다.

_${MAINTAINER_CANVAS_VERSION}_`,
    },
    {
      key: "design",
      channelId: design,
      title: "Maintainer Design Studio · 보이는 경험 만들기",
      topic: "화면·콘텐츠·정보 구조·접근성을 함께 관찰하고 만들기",
      purpose:
        "코딩 없이도 실제 회원 경험을 관찰하고 시안·카피·접근성·브라우저 QA를 제품에 반영하는 디자인 스튜디오입니다.",
      markdown: `# Maintainer Design Studio · 보이는 경험 만들기
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

_${MAINTAINER_CANVAS_VERSION}_`,
    },
    {
      key: "community",
      channelId: community,
      title: "Maintainer Community Studio · 사람과 모임 연결하기",
      topic: "질문·Q&A·첫 기여 OT·모임으로 사람과 참여 연결하기",
      purpose:
        "회원을 돕고 Q&A·허들·첫 기여 OT를 열며 관심사를 이벤트와 챕터로 연결하는 커뮤니티 스튜디오입니다.",
      markdown: `# Maintainer Community Studio · 사람과 모임 연결하기
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

_${MAINTAINER_CANVAS_VERSION}_`,
    },
  ];
}

function channelCanvasId(info: Record<string, unknown>): string | null {
  const channel = object(info.channel);
  const properties = channel.properties;
  if (typeof properties !== "object" || properties === null || Array.isArray(properties))
    return null;
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
    const documentContent = { type: "markdown", markdown: definition.markdown } as const;
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
    receipts.push({ key: definition.key, channelId: definition.channelId, canvasId });
  }
  return receipts;
}
