import type { CommunityContext } from "./community-runtime";
import { CommunitySlackError, callSlack } from "./community-social";
import { InputError, list, object, string } from "./input";

export type ProductOwnerSpecialty = "designer" | "dev";

const GROUPS = {
  po: {
    handle: "po",
    name: "Product Owners",
    description: "OT1L 제품 제안, DRI, 검증과 운영 개선에 참여하는 Product Owner",
  },
  designer: {
    handle: "po-designer",
    name: "PO Designers",
    description: "OT1L 화면, 콘텐츠와 접근성을 함께 만드는 Product Owner",
  },
  dev: {
    handle: "po-dev",
    name: "PO Developers",
    description: "OT1L 기능, QA와 배포 검증을 함께하는 Product Owner",
  },
} as const;

type ProductOwnerGroupKey = keyof typeof GROUPS;

type ProductOwnerGroup = {
  readonly id: string;
  readonly handle: string;
  readonly users: readonly string[];
  readonly disabled: boolean;
};

function productOwnerGroup(value: unknown): ProductOwnerGroup {
  const group = object(value);
  return {
    id: string(group.id),
    handle: string(group.handle),
    users: list(group.users ?? []).map(string),
    disabled: Number(group.date_delete ?? 0) > 0,
  };
}

async function listProductOwnerGroups(
  token: string,
): Promise<ReadonlyMap<string, ProductOwnerGroup>> {
  const response = await callSlack(token, "usergroups.list", {
    include_users: true,
    include_disabled: true,
  });
  return new Map(
    list(response.usergroups)
      .map(productOwnerGroup)
      .filter((group) =>
        Object.values(GROUPS).some((definition) => definition.handle === group.handle),
      )
      .map((group) => [group.handle, group] as const),
  );
}

async function requireGroup(token: string, key: ProductOwnerGroupKey): Promise<ProductOwnerGroup> {
  const definition = GROUPS[key];
  const group = (await listProductOwnerGroups(token)).get(definition.handle);
  if (!group)
    throw new InputError(
      `@${definition.handle} 멘션 그룹이 아직 준비되지 않았어요. 운영자에게 알려주세요.`,
    );
  return group;
}

async function setActorMembership(
  token: string,
  key: ProductOwnerGroupKey,
  userId: string,
  included: boolean,
): Promise<ProductOwnerGroup> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const group = await requireGroup(token, key);
    const desired = new Set(group.users);
    if (included) desired.add(userId);
    else desired.delete(userId);
    if (included === (!group.disabled && group.users.includes(userId))) return group;
    if (!desired.size) {
      if (!group.disabled) await callSlack(token, "usergroups.disable", { usergroup: group.id });
    } else {
      if (group.disabled)
        try {
          await callSlack(token, "usergroups.enable", { usergroup: group.id });
        } catch (error) {
          if (!(error instanceof CommunitySlackError) || error.code !== "already_enabled")
            throw error;
        }
      await callSlack(token, "usergroups.users.update", {
        usergroup: group.id,
        users: [...desired].sort(),
      });
    }
    const readback = await requireGroup(token, key);
    if ((!readback.disabled && readback.users.includes(userId)) === included) return readback;
  }
  throw new InputError(`@${GROUPS[key].handle} 멘션 그룹 반영을 확인하지 못했어요.`);
}

export async function syncProductOwnerBaseGroup(
  token: string,
  userId: string,
  active: boolean,
): Promise<ProductOwnerGroup> {
  return setActorMembership(token, "po", userId, active);
}

export async function currentProductOwnerSpecialties(
  token: string,
  userId: string,
): Promise<readonly ProductOwnerSpecialty[]> {
  const groups = await listProductOwnerGroups(token);
  return (["designer", "dev"] as const).filter((key) =>
    groups.get(GROUPS[key].handle)?.disabled
      ? false
      : groups.get(GROUPS[key].handle)?.users.includes(userId),
  );
}

export async function setProductOwnerSpecialties(
  token: string,
  userId: string,
  selected: readonly ProductOwnerSpecialty[],
): Promise<readonly ProductOwnerGroup[]> {
  const desired = new Set(selected);
  return Promise.all(
    (["designer", "dev"] as const).map((key) =>
      setActorMembership(token, key, userId, desired.has(key)),
    ),
  );
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
  const selected = new Set(
    await currentProductOwnerSpecialties(context.env.SLACK_BOT_TOKEN, context.scope.userId),
  );
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
      private_metadata: JSON.stringify({ ownerId: context.scope.userId }),
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
              text: "기본 `@po`는 Product Owner 승격과 함께 관리됩니다. 전문 그룹은 언제든 다시 바꿀 수 있어요.",
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
  if (
    (await context.store.maintainerStatus(context.scope.teamId, context.scope.userId))?.state !==
    "active"
  )
    throw new InputError("활성 Product Owner만 전문 그룹을 바꿀 수 있어요.");
  const values = object(object(view.state).values);
  const selectedOptions = list(object(object(values.specialties).value).selected_options ?? []);
  const selected = selectedOptions.map((option) => string(object(option).value));
  if (selected.some((value) => value !== "designer" && value !== "dev"))
    throw new InputError("PO 전문 그룹 선택을 확인해 주세요.");
  const specialties = selected as ProductOwnerSpecialty[];
  await setProductOwnerSpecialties(context.env.SLACK_BOT_TOKEN, context.scope.userId, specialties);
  const handles = specialties.map((value) => `@${GROUPS[value].handle}`);
  await callSlack(context.env.SLACK_BOT_TOKEN, "chat.postEphemeral", {
    channel: context.scope.channelId,
    user: context.scope.userId,
    text: handles.length
      ? `PO 전문 그룹을 ${handles.join(", ")}로 저장했어요.`
      : "PO 전문 그룹을 비웠어요. 기본 @po 역할은 유지됩니다.",
  });
}

export async function ensureProductOwnerGroups(
  token: string,
  channels: {
    readonly po: readonly string[];
    readonly designer: readonly string[];
    readonly dev: readonly string[];
  },
): Promise<readonly ProductOwnerGroup[]> {
  const existing = await listProductOwnerGroups(token);
  const result: ProductOwnerGroup[] = [];
  for (const key of ["po", "designer", "dev"] as const) {
    const definition = GROUPS[key];
    let group = existing.get(definition.handle);
    if (!group) {
      const created = await callSlack(token, "usergroups.create", {
        name: definition.name,
        handle: definition.handle,
        description: definition.description,
        channels: [...channels[key]],
      });
      group = productOwnerGroup(created.usergroup);
    } else {
      const updated = await callSlack(token, "usergroups.update", {
        usergroup: group.id,
        name: definition.name,
        handle: definition.handle,
        description: definition.description,
        channels: [...channels[key]],
      });
      group = productOwnerGroup(updated.usergroup);
    }
    result.push(group);
  }
  return result;
}
