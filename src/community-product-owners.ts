import type { CommunityEnv } from "./community-runtime";
import { callSlack } from "./community-social";
import { InputError, type Json, list, object, string } from "./input";
import { NeonStore } from "./store";

export type ProductOwnerRole = "po" | "po-designer" | "po-dev";
type ProductOwner = {
  readonly userId: string;
  readonly displayName: string;
  readonly role: ProductOwnerRole;
  readonly expertise: readonly string[];
};

export const PRODUCT_OWNER_CHANNEL_GUIDE = [
  "#po: 제품 방향, 우선순위와 전체 공지",
  "#po-work: 제안, /po 보드와 진행 중인 작업",
  "#po-designer: 사용자 경험과 디자인 도움 요청",
  "#po-dev: 구현과 기술 도움 요청",
  "#maintainers-sys-alert: 배포와 운영 알림",
].join("\n");

function channels(env: CommunityEnv): readonly string[] {
  return [
    ...new Set(
      [
        env.COMMUNITY_PO_CHANNEL_ID,
        env.COMMUNITY_PO_WORK_CHANNEL_ID,
        env.COMMUNITY_PO_DESIGNER_CHANNEL_ID,
        env.COMMUNITY_PO_DEV_CHANNEL_ID,
        env.COMMUNITY_SYS_ALERT_CHANNEL_ID,
      ].filter((value): value is string => Boolean(value && /^[CG][A-Z0-9]+$/.test(value))),
    ),
  ];
}

export class ProductOwnerStore {
  constructor(private readonly env: Pick<CommunityEnv, "DATABASE_URL" | "SLACK_TEAM_ID">) {}
  async execute(op: "list" | "upsert", payload: Record<string, Json>): Promise<Json> {
    return new NeonStore(this.env.DATABASE_URL).queryJson(
      "SELECT otl.product_owner_execute($1,$2::jsonb)",
      [op, JSON.stringify({ ...payload, teamId: this.env.SLACK_TEAM_ID })],
    );
  }
  async list(role?: ProductOwnerRole): Promise<readonly ProductOwner[]> {
    return list(await this.execute("list", role ? { role } : {})).map((entry) => {
      const value = object(entry);
      const selectedRole = string(value.role);
      if (!["po", "po-designer", "po-dev"].includes(selectedRole))
        throw new InputError("Product Owner 역할 데이터가 올바르지 않습니다.");
      return {
        userId: string(value.userId),
        displayName: string(value.displayName),
        role: selectedRole as ProductOwnerRole,
        expertise: list(value.expertise).map(string),
      };
    });
  }
}

export async function activateProductOwner(
  env: CommunityEnv,
  input: {
    readonly userId: string;
    readonly displayName: string;
    readonly role: ProductOwnerRole;
    readonly expertise: readonly string[];
  },
): Promise<void> {
  const targetChannels = channels(env);
  if (targetChannels.length !== 5) throw new InputError("Product Owner 채널 5개를 확인해 주세요.");
  for (const channel of targetChannels)
    await callSlack(env.SLACK_BOT_TOKEN, "conversations.invite", { channel, users: input.userId });
  await new ProductOwnerStore(env).execute("upsert", {
    userId: input.userId,
    displayName: input.displayName,
    role: input.role,
    expertise: [...new Set(input.expertise.map((value) => value.trim()).filter(Boolean))].slice(
      0,
      10,
    ),
  });
}

export async function productOwnerBoard(env: CommunityEnv): Promise<Json> {
  const owners = await new ProductOwnerStore(env).list();
  const rows = owners.map(
    (owner) =>
      `<@${owner.userId}> · @${owner.role}${owner.expertise.length ? ` · ${owner.expertise.join(", ")}` : ""}`,
  );
  return {
    response_type: "ephemeral",
    text: rows.length
      ? `Product Owner 보드\n${rows.join("\n")}`
      : "Product Owner 보드가 비어 있어요.",
  };
}

export async function productOwnerMentions(
  env: CommunityEnv,
  role: ProductOwnerRole,
): Promise<string> {
  const owners = await new ProductOwnerStore(env).list(role);
  if (!owners.length) throw new InputError(`@${role}로 부를 수 있는 Product Owner가 아직 없어요.`);
  return owners.map((owner) => `<@${owner.userId}>`).join(" ");
}

export function productOwnerMentionModal(): Json {
  return {
    type: "modal",
    callback_id: "community_po_mention_submit",
    title: { type: "plain_text", text: "Product Owner 호출" },
    submit: { type: "plain_text", text: "호출" },
    close: { type: "plain_text", text: "취소" },
    blocks: [
      {
        type: "input",
        block_id: "role",
        label: { type: "plain_text", text: "도움받을 분야" },
        element: {
          type: "static_select",
          action_id: "value",
          options: ["po", "po-designer", "po-dev"].map((value) => ({
            text: { type: "plain_text", text: `@${value}` },
            value,
          })),
        },
      },
    ],
  };
}
