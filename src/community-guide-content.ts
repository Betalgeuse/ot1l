import type { CommunityEnv } from "./community-runtime";
import { InputError } from "./input";

const FILE_ID = /^F[A-Z0-9]+$/;
const SECTION_LIMIT = 2900;

export type WelcomeGuideContent = {
  readonly body: string;
  readonly orderedFileIds: readonly [string, string];
  readonly hash: string;
};

type GuideChannelEnv = Pick<CommunityEnv, "COMMUNITY_PUBLIC_CHANNEL_ID">;

export function renderGuideChannels(body: string, env: GuideChannelEnv): string {
  const channelId = env.COMMUNITY_PUBLIC_CHANNEL_ID;
  if (typeof channelId !== "string" || !/^[CG][A-Z0-9]{8,}$/.test(channelId))
    throw new InputError("환영 안내 채널 설정을 확인해 주세요.");
  let seen = 0;
  const rendered = body.replace(
    /^([ \t]*(?:▪︎|◦)[ \t]*)#daily-scrum(?=[:에])/gm,
    (_match, prefix: string) => {
      seen += 1;
      return `${prefix}<#${channelId}>`;
    },
  );
  if (seen !== 1) throw new InputError("환영 안내 채널 표기를 확인해 주세요.");
  return rendered;
}

export function parseGuideFileIds(value: string | undefined): readonly [string, string] {
  const ids = value?.split(",").map((id) => id.trim()) ?? [];
  if (ids.length !== 2 || ids[0] === ids[1] || !ids.every((id) => FILE_ID.test(id)))
    throw new InputError("환영 안내 이미지 설정을 확인해 주세요.");
  const first = ids[0];
  const second = ids[1];
  if (!first || !second) throw new InputError("환영 안내 이미지 설정을 확인해 주세요.");
  return [first, second];
}

export function sanitizeGuideBody(body: string): string {
  return body
    .replace(/<!(channel|here|everyone)>/g, "@$1")
    .replace(
      /<[^>]*>|https?:\/\/\S+|원씽|\b(?:one\s*thing|onthing)\b/gi,
      (part, offset: number, source: string) => {
        if (part.startsWith("<") || /^https?:/i.test(part)) return part;
        const alreadyInsideSlackEmphasis =
          source[offset - 1] === "*" || source[offset + part.length] === "*";
        return alreadyInsideSlackEmphasis ? "ONE THING" : "*ONE THING*";
      },
    );
}

export async function canonicalGuideContent(
  body: string,
  orderedFileIds: readonly [string, string],
): Promise<WelcomeGuideContent> {
  const sanitized = sanitizeGuideBody(body);
  const envelope = JSON.stringify({ version: 1, body: sanitized, orderedFileIds });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(envelope));
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return { body: sanitized, orderedFileIds, hash };
}

export function guideBlocks(userId: string, guide: WelcomeGuideContent, renderedBody: string) {
  const introduction = `<@${userId}> 어서 오세요!!! 처음 오셨다면 이 안내부터 함께 읽어주세요.\n\n${renderedBody}`;
  const parts: string[] = [];
  let remaining = introduction;
  while (remaining.length > SECTION_LIMIT) {
    const boundary = remaining.lastIndexOf("\n", SECTION_LIMIT);
    if (boundary < 0) throw new InputError("환영 안내 문단이 너무 깁니다.");
    parts.push(remaining.slice(0, boundary + 1));
    remaining = remaining.slice(boundary + 1);
  }
  parts.push(remaining);
  const sections = parts.map((part) => ({
    type: "section",
    text: {
      type: "mrkdwn",
      text: part,
    },
  }));
  return [
    ...sections,
    {
      type: "image",
      slack_file: { id: guide.orderedFileIds[0] },
      alt_text: "OT1L 로고",
      title: { type: "plain_text", text: "OT1L" },
    },
    {
      type: "image",
      slack_file: { id: guide.orderedFileIds[1] },
      alt_text: "daily scrum 진행 화면",
      title: { type: "plain_text", text: "매일의 ONE THING" },
    },
  ];
}
