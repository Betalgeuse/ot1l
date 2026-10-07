import { escapeSlackText } from "./community-messages";
import { type CommunityContext, type CommunityEnv, ephemeral } from "./community-runtime";
import { callSlack } from "./community-social";
import { InputError, list, object, string } from "./input";
import { NeonStore } from "./store";

export type ProductOwnerSpecialty = "designer" | "dev";
export type ProductOwnerAudience = "po" | "po-designer" | "po-dev";

const SPECIALTY_LABELS = {
  designer: "@po-designer",
  dev: "@po-dev",
} as const;

class ProductOwnerAudienceStore {
  constructor(
    private readonly env: Pick<
      CommunityEnv,
      "DATABASE_URL" | "SLACK_TEAM_ID" | "COMMUNITY_ADMIN_ID"
    >,
  ) {}

  async execute(
    op: "get" | "set" | "members",
    actorId: string,
    payload: Record<string, unknown> = {},
  ): Promise<unknown> {
    return new NeonStore(this.env.DATABASE_URL).queryJson(
      "SELECT otl.product_owner_audience_execute($1,$2::jsonb)",
      [
        op,
        JSON.stringify({
          ...payload,
          teamId: this.env.SLACK_TEAM_ID,
          actorId,
          founderId: this.env.COMMUNITY_ADMIN_ID,
        }),
      ],
    );
  }
}

function audienceStore(context: CommunityContext): ProductOwnerAudienceStore {
  return new ProductOwnerAudienceStore(context.env);
}

export async function currentProductOwnerSpecialties(
  context: CommunityContext,
): Promise<readonly ProductOwnerSpecialty[]> {
  return list(await audienceStore(context).execute("get", context.scope.userId)).map(
    (value) => string(value) as ProductOwnerSpecialty,
  );
}

export async function setProductOwnerSpecialties(
  context: CommunityContext,
  selected: readonly ProductOwnerSpecialty[],
): Promise<readonly ProductOwnerSpecialty[]> {
  return list(
    await audienceStore(context).execute("set", context.scope.userId, {
      specialties: [...new Set(selected)].sort(),
    }),
  ).map((value) => string(value) as ProductOwnerSpecialty);
}

async function productOwnerAudienceMembers(
  context: CommunityContext,
  audience: ProductOwnerAudience,
): Promise<readonly string[]> {
  return list(
    await audienceStore(context).execute("members", context.scope.userId, { audience }),
  ).map((value) => string(value));
}

function modalMetadata(context: CommunityContext): string {
  return JSON.stringify({
    userId: context.scope.userId,
    channelId: context.scope.channelId,
    date: context.date,
    source: context.source,
    thread: context.thread,
  });
}

export async function openProductOwnerSpecialties(
  context: CommunityContext,
  triggerId: string,
): Promise<void> {
  if (
    (await context.store.maintainerStatus(context.scope.teamId, context.scope.userId))?.state !==
    "active"
  )
    throw new InputError("Product Owner를 먼저 활성화해 주세요.");
  const selected = new Set(await currentProductOwnerSpecialties(context));
  const options = (["designer", "dev"] as const).map((value) => ({
    text: {
      type: "plain_text",
      text: value === "designer" ? "PO Designer · 디자인·콘텐츠·접근성" : "PO Dev · 기능·QA·개발",
    },
    value,
  }));
  await callSlack(context.env.SLACK_BOT_TOKEN, "views.open", {
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "community_po_specialties_submit",
      private_metadata: modalMetadata(context),
      title: { type: "plain_text", text: "PO 전문 그룹" },
      submit: { type: "plain_text", text: "저장" },
      close: { type: "plain_text", text: "닫기" },
      blocks: [
        {
          type: "input",
          block_id: "specialties",
          optional: true,
          label: { type: "plain_text", text: "참여할 전문 그룹" },
          element: {
            type: "checkboxes",
            action_id: "value",
            options,
            initial_options: options.filter((option) =>
              selected.has(option.value as ProductOwnerSpecialty),
            ),
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "기본 `@po` 대상은 Product Owner 승격과 함께 관리됩니다. 전문 그룹은 언제든 다시 바꿀 수 있어요.",
            },
          ],
        },
      ],
    },
  });
}

export async function submitProductOwnerSpecialties(
  context: CommunityContext,
  view: Record<string, unknown>,
): Promise<void> {
  const values = object(object(view.state).values);
  const selectedOptions = list(object(object(values.specialties).value).selected_options ?? []);
  const selected = selectedOptions.map((option) => string(object(option).value));
  if (selected.some((value) => value !== "designer" && value !== "dev"))
    throw new InputError("PO 전문 그룹 선택을 확인해 주세요.");
  const specialties = await setProductOwnerSpecialties(
    context,
    selected as ProductOwnerSpecialty[],
  );
  const handles = specialties.map((value) => SPECIALTY_LABELS[value]);
  await ephemeral(context, {
    text: handles.length
      ? `PO 전문 그룹을 ${handles.join(", ")}로 저장했어요.`
      : "PO 전문 그룹을 비웠어요. 기본 @po 대상은 유지됩니다.",
  });
}

export async function openProductOwnerMention(
  context: CommunityContext,
  triggerId: string,
): Promise<void> {
  if (
    (await context.store.maintainerStatus(context.scope.teamId, context.scope.userId))?.state !==
    "active"
  )
    throw new InputError("활성 Product Owner만 PO를 부를 수 있어요.");
  await callSlack(context.env.SLACK_BOT_TOKEN, "views.open", {
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "community_po_mention_submit",
      private_metadata: modalMetadata(context),
      title: { type: "plain_text", text: "PO 부르기" },
      submit: { type: "plain_text", text: "멘션 보내기" },
      close: { type: "plain_text", text: "닫기" },
      blocks: [
        {
          type: "input",
          block_id: "audience",
          label: { type: "plain_text", text: "누구를 부를까요?" },
          element: {
            type: "static_select",
            action_id: "value",
            initial_option: {
              text: { type: "plain_text", text: "@po · 모든 Product Owner" },
              value: "po",
            },
            options: [
              {
                text: { type: "plain_text", text: "@po · 모든 Product Owner" },
                value: "po",
              },
              {
                text: { type: "plain_text", text: "@po-designer · 디자인·콘텐츠" },
                value: "po-designer",
              },
              {
                text: { type: "plain_text", text: "@po-dev · 기능·QA·개발" },
                value: "po-dev",
              },
            ],
          },
        },
        {
          type: "input",
          block_id: "message",
          label: { type: "plain_text", text: "왜 부르는지 한 줄로 알려주세요" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            multiline: true,
            max_length: 300,
            placeholder: {
              type: "plain_text",
              text: "예: 이벤트 신청 흐름을 같이 검토해 주세요.",
            },
          },
        },
      ],
    },
  });
}

export async function submitProductOwnerMention(
  context: CommunityContext,
  view: Record<string, unknown>,
): Promise<void> {
  const values = object(object(view.state).values);
  const audience = string(object(object(object(values.audience).value).selected_option).value);
  if (audience !== "po" && audience !== "po-designer" && audience !== "po-dev")
    throw new InputError("PO 멘션 대상을 확인해 주세요.");
  const message = string(object(object(values.message).value).value).trim();
  if (!message || message.length > 300) throw new InputError("PO를 부르는 이유를 확인해 주세요.");
  const members = await productOwnerAudienceMembers(context, audience);
  if (!members.length) throw new InputError(`@${audience}에 등록된 Product Owner가 아직 없어요.`);
  await callSlack(context.env.SLACK_BOT_TOKEN, "chat.postMessage", {
    channel: context.scope.channelId,
    thread_ts: context.thread,
    text: `${members.map((userId) => `<@${userId}>`).join(" ")}\n${escapeSlackText(message)}\n\n_<@${context.scope.userId}>님이 @${audience} 대상을 불렀어요._`,
  });
}
