import {
  canonicalGuideContent,
  parseGuideFileIds,
  renderGuideChannels,
} from "./community-guide-content";
import { WELCOME_GUIDE_RELEASE } from "./community-guide-release";
import { syncWelcomeGuideSurface } from "./community-guide-surface";
import { escapeSlackText } from "./community-messages";
import { type CommunityContext, ephemeral } from "./community-runtime";
import { CommunitySlackError, callSlack } from "./community-social";
import type { CommunityChapter } from "./community-types";
import { InputError, type Json, list, object, string } from "./input";
import { openView } from "./slack-api";

export type CommunityChapterInput = {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
};

export function chapterCreateButton(): Json {
  return {
    type: "button",
    text: { type: "plain_text", text: "나도 관심주제 채널 만들기" },
    action_id: "community_chapter_open",
    value: JSON.stringify({ ownerId: "actor", key: "new-community-chapter" }),
    accessibility_label: "새 관심주제 Chapter 공개 채널 만들기",
  };
}

function chapterMetadata(context: CommunityContext): string {
  return JSON.stringify({
    userId: context.scope.userId,
    channelId: context.scope.channelId,
    thread: context.thread,
    source: context.source,
    date: context.date,
  });
}

export async function openCommunityChapterModal(
  context: CommunityContext,
  triggerId: string,
): Promise<void> {
  await openView(context.env.SLACK_BOT_TOKEN, {
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "community_chapter_submit",
      title: { type: "plain_text", text: "관심주제 Chapter" },
      submit: { type: "plain_text", text: "공개 채널 만들기" },
      close: { type: "plain_text", text: "닫기" },
      private_metadata: chapterMetadata(context),
      blocks: [
        {
          type: "input",
          block_id: "title",
          label: { type: "plain_text", text: "Chapter 이름" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            max_length: 60,
            placeholder: { type: "plain_text", text: "AI 연구 같이 보기" },
          },
        },
        {
          type: "input",
          block_id: "slug",
          label: { type: "plain_text", text: "채널 이름" },
          hint: {
            type: "plain_text",
            text: "영문 소문자·숫자·하이픈만 사용해 주세요. chapter-가 앞에 자동으로 붙어요.",
          },
          element: {
            type: "plain_text_input",
            action_id: "value",
            max_length: 48,
            placeholder: { type: "plain_text", text: "ai-research" },
          },
        },
        {
          type: "input",
          block_id: "description",
          label: { type: "plain_text", text: "어떤 이야기를 나누나요?" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            multiline: true,
            max_length: 240,
            placeholder: { type: "plain_text", text: "논문과 실험을 함께 읽고 이야기해요." },
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "공개 채널로 만들고, 만든 사람을 자동 초대해요. 새 Chapter는 Townhall과 welcome-start-here에 자동으로 알려집니다.",
            },
          ],
        },
      ],
    },
  } as Json);
}

export function parseCommunityChapter(
  view: Record<string, unknown>,
): CommunityChapterInput | { readonly errors: Record<string, string> } {
  const values = object(object(view.state).values);
  const title = string(object(object(values.title).value).value).trim();
  const slug = string(object(object(values.slug).value).value)
    .trim()
    .toLowerCase();
  const description = string(object(object(values.description).value).value).trim();
  const errors: Record<string, string> = {};
  if (title.length < 2 || title.length > 60) errors.title = "Chapter 이름을 2~60자로 적어 주세요.";
  if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(slug))
    errors.slug = "영문 소문자·숫자·하이픈으로 2~48자를 적어 주세요.";
  if (description.length < 5 || description.length > 240)
    errors.description = "나눌 이야기를 5~240자로 적어 주세요.";
  return Object.keys(errors).length ? { errors } : { slug, title, description };
}

async function findBotChapterChannel(
  context: CommunityContext,
  name: string,
): Promise<string | null> {
  let cursor = "";
  do {
    const result = await callSlack(context.env.SLACK_BOT_TOKEN, "conversations.list", {
      types: "public_channel",
      exclude_archived: true,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    for (const item of list(result.channels)) {
      const channel = object(item);
      if (
        channel.name === name &&
        channel.creator === context.env.COMMUNITY_BOT_USER_ID &&
        channel.is_archived !== true
      )
        return string(channel.id);
    }
    cursor = string(object(result.response_metadata ?? {}).next_cursor ?? "");
  } while (cursor);
  return null;
}

async function ensureTownhallAnnouncement(
  context: CommunityContext,
  chapter: CommunityChapter,
): Promise<CommunityChapter> {
  const townhall = context.env.COMMUNITY_RELEASE_CHANNEL_ID;
  if (!townhall || !chapter.channelId || chapter.announcementMessageTs) return chapter;
  const history = await callSlack(context.env.SLACK_BOT_TOKEN, "conversations.history", {
    channel: townhall,
    limit: 200,
  });
  const existing = list(history.messages)
    .map(object)
    .find(
      (message) =>
        typeof message.text === "string" &&
        message.text.includes("새로운 관심주제 Chapter가 열렸어요") &&
        message.text.includes(`<#${chapter.channelId}>`),
    );
  const messageTs = existing
    ? string(existing.ts)
    : string(
        (
          await callSlack(context.env.SLACK_BOT_TOKEN, "chat.postMessage", {
            channel: townhall,
            text: `<!channel> 새로운 관심주제 Chapter가 열렸어요! <#${chapter.channelId}>\n*${escapeSlackText(chapter.title)}* · ${escapeSlackText(chapter.description)}\n<@${chapter.createdBy}>님이 시작했어요. 관심 있는 분은 채널에 참여해 주세요!`,
            unfurl_links: false,
            unfurl_media: false,
          })
        ).ts,
      );
  return context.store.markCommunityChapterAnnouncement({
    teamId: chapter.teamId,
    slug: chapter.slug,
    channelId: chapter.channelId,
    messageTs,
  });
}

export async function syncCommunityChapterGuide(
  context: Pick<CommunityContext, "env" | "store" | "scope">,
): Promise<void> {
  const chapters = await context.store.listCommunityChapters(context.scope.teamId);
  const guide = await canonicalGuideContent(
    WELCOME_GUIDE_RELEASE.body,
    parseGuideFileIds(context.env.COMMUNITY_GUIDE_FILE_IDS),
  );
  await syncWelcomeGuideSurface(
    { ...guide, version: WELCOME_GUIDE_RELEASE.version },
    renderGuideChannels(
      guide.body,
      context.env,
      chapters.flatMap((chapter) =>
        chapter.channelId
          ? [
              {
                channelId: chapter.channelId,
                title: chapter.title,
                description: chapter.description,
              },
            ]
          : [],
      ),
    ),
    context.env,
  );
  await Promise.all(
    chapters.flatMap((chapter) =>
      chapter.channelId && !chapter.guideSynced
        ? [
            context.store.markCommunityChapterGuide({
              teamId: chapter.teamId,
              slug: chapter.slug,
              channelId: chapter.channelId,
            }),
          ]
        : [],
    ),
  );
}

async function ensureChapterPublished(
  context: CommunityContext,
  chapter: CommunityChapter,
): Promise<void> {
  const announced = await ensureTownhallAnnouncement(context, chapter);
  if (!announced.guideSynced) await syncCommunityChapterGuide(context);
}

export async function reconcileCommunityChapters(
  env: CommunityContext["env"],
  store: CommunityContext["store"],
): Promise<number> {
  const chapters = await store.listCommunityChapters(env.SLACK_TEAM_ID);
  let processed = 0;
  const context = {
    env,
    store,
    scope: {
      teamId: env.SLACK_TEAM_ID,
      channelId: env.COMMUNITY_RELEASE_CHANNEL_ID ?? "",
      userId: env.COMMUNITY_ADMIN_ID ?? "",
    },
    date: "",
    thread: "",
    source: "",
    key: "chapter-reconcile",
  } satisfies CommunityContext;
  for (const chapter of chapters) {
    if (chapter.announcementMessageTs && chapter.guideSynced) continue;
    await ensureChapterPublished(context, chapter);
    processed += 1;
  }
  return processed;
}

export async function createCommunityChapter(
  context: CommunityContext,
  input: CommunityChapterInput,
): Promise<void> {
  let completedChannelId: string | null = null;
  try {
    let chapter = await context.store.requestCommunityChapter({
      teamId: context.scope.teamId,
      actorId: context.scope.userId,
      ...input,
    });
    const channelName = `chapter-${input.slug}`;
    let channelId = chapter.channelId;
    if (!channelId) {
      channelId = await findBotChapterChannel(context, channelName);
      if (!channelId) {
        const created = object(
          (
            await callSlack(context.env.SLACK_BOT_TOKEN, "conversations.create", {
              name: channelName,
              is_private: false,
            })
          ).channel,
        );
        channelId = string(created.id);
        if (created.name !== channelName || created.creator !== context.env.COMMUNITY_BOT_USER_ID)
          throw new InputError("새 Chapter 채널의 생성자를 확인하지 못했어요.");
      }
      await callSlack(context.env.SLACK_BOT_TOKEN, "conversations.setPurpose", {
        channel: channelId,
        purpose: input.description,
      });
      try {
        await callSlack(context.env.SLACK_BOT_TOKEN, "conversations.invite", {
          channel: channelId,
          users: context.scope.userId,
        });
      } catch (error) {
        if (!(error instanceof CommunitySlackError) || error.code !== "already_in_channel")
          throw error;
      }
      chapter = await context.store.activateCommunityChapter({
        teamId: context.scope.teamId,
        actorId: context.scope.userId,
        slug: input.slug,
        channelId,
      });
    }
    await ensureChapterPublished(context, chapter);
    completedChannelId = channelId;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "community.chapter.create.failed",
        errorType: error instanceof Error ? error.name : "Unknown",
      }),
    );
    await ephemeral(context, {
      text:
        error instanceof CommunitySlackError && error.code === "name_taken"
          ? "이미 같은 이름의 채널이 있어요. 다른 채널 이름으로 다시 시도해 주세요."
          : "Chapter를 모두 반영하지 못했어요. 같은 내용으로 다시 누르면 이어서 복구합니다.",
    });
    return;
  }
  try {
    await ephemeral(context, {
      text: `<#${completedChannelId}> Chapter를 준비했어요. Townhall 홍보와 welcome-start-here 목록도 갱신했습니다.`,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "community.chapter.success_notice_failed",
        errorType: error instanceof Error ? error.name : "Unknown",
      }),
    );
  }
}
