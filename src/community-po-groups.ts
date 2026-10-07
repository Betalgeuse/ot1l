import { escapeSlackText } from "./community-messages";
import type { CommunityContext } from "./community-runtime";
import { callSlack } from "./community-social";
import { type Json, object, string } from "./input";

export function poSpecialtyButton(): Json {
  return {
    type: "button",
    text: { type: "plain_text", text: "전문 그룹 설정" },
    action_id: "community_po_specialties",
    value: JSON.stringify({ ownerId: "actor", key: "po-specialties" }),
  };
}

export function summonPoButton(): Json {
  return {
    type: "button",
    text: { type: "plain_text", text: "@po 부르기" },
    action_id: "community_po_summon",
    value: JSON.stringify({ ownerId: "actor", key: "po-summon" }),
  };
}

function metadata(context: CommunityContext): string {
  return JSON.stringify({
    channelId: context.scope.channelId,
    userId: context.scope.userId,
    source: context.source,
    thread: context.thread,
    date: context.date,
  });
}

export async function openPoSpecialties(
  context: CommunityContext,
  triggerId: string,
): Promise<void> {
  await callSlack(context.env.SLACK_BOT_TOKEN, "views.open", {
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "community_po_specialties_submit",
      private_metadata: metadata(context),
      title: { type: "plain_text", text: "전문 그룹 설정" },
      submit: { type: "plain_text", text: "저장" },
      blocks: [
        {
          type: "input",
          block_id: "specialties",
          optional: true,
          label: { type: "plain_text", text: "참여할 전문 그룹" },
          element: {
            type: "checkboxes",
            action_id: "value",
            options: [
              { text: { type: "plain_text", text: "디자인 · @po-designer" }, value: "designer" },
              { text: { type: "plain_text", text: "개발 · @po-dev" }, value: "dev" },
            ],
          },
        },
      ],
    },
  });
}

export async function openPoSummon(context: CommunityContext, triggerId: string): Promise<void> {
  await callSlack(context.env.SLACK_BOT_TOKEN, "views.open", {
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "community_po_summon_submit",
      private_metadata: metadata(context),
      title: { type: "plain_text", text: "@po 부르기" },
      submit: { type: "plain_text", text: "부르기" },
      blocks: [
        {
          type: "input",
          block_id: "audiences",
          label: { type: "plain_text", text: "부를 대상" },
          element: {
            type: "checkboxes",
            action_id: "value",
            options: [
              { text: { type: "plain_text", text: "@po · 활성 Product Owner 전체" }, value: "po" },
              { text: { type: "plain_text", text: "@po-designer" }, value: "designer" },
              { text: { type: "plain_text", text: "@po-dev" }, value: "dev" },
            ],
          },
        },
        {
          type: "input",
          block_id: "reason",
          label: { type: "plain_text", text: "부르는 이유 한 줄" },
          element: { type: "plain_text_input", action_id: "value", max_length: 200 },
        },
      ],
    },
  });
}

function selections(view: Record<string, unknown>, block: string): string[] {
  const values = object(object(view.state).values);
  const selected = object(object(values[block]).value).selected_options;
  return Array.isArray(selected) ? selected.map((item) => string(object(item).value)) : [];
}

export async function submitPoSpecialties(
  context: CommunityContext,
  view: Record<string, unknown>,
) {
  const selected = selections(view, "specialties");
  const specialties = selected.filter(
    (value): value is "designer" | "dev" => value === "designer" || value === "dev",
  );
  await context.store.setMaintainerSpecialties(
    context.scope.teamId,
    context.scope.userId,
    specialties,
  );
}

export async function submitPoSummon(context: CommunityContext, view: Record<string, unknown>) {
  const selected = selections(view, "audiences").filter(
    (value) => value === "po" || value === "designer" || value === "dev",
  );
  const values = object(object(view.state).values);
  const reason = string(object(object(values.reason).value).value).trim();
  const errors: Record<string, string> = {};
  if (!selected.length) errors.audiences = "대상을 하나 이상 골라 주세요.";
  if (!reason || /[\r\n]/.test(reason)) errors.reason = "이유를 한 줄 적어 주세요.";
  if (Object.keys(errors).length) return errors;
  const audiences = await context.store.maintainerAudiences(
    context.scope.teamId,
    context.scope.userId,
  );
  const ids = [...new Set(selected.flatMap((name) => audiences[name as keyof typeof audiences]))];
  if (!ids.length) return { audiences: "지금 부를 수 있는 활성 Product Owner가 없어요." };
  await callSlack(context.env.SLACK_BOT_TOKEN, "chat.postMessage", {
    channel: context.scope.channelId,
    thread_ts: context.thread,
    text: `${ids.map((id) => `<@${id}>`).join(" ")}\n${escapeSlackText(reason)}`,
  });
  return null;
}
