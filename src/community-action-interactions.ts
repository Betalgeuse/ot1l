import type { parseBugAnswerActionId } from "./community-bug-actions";
import { handleBugAction } from "./community-bug-interactions";
import { openCommunityChapterModal } from "./community-chapters";
import { openSettings, openShoutout } from "./community-controls";
import {
  closeEventDemand,
  getEventDemand,
  openDemandHostingModal,
  openEventDemandModal,
} from "./community-event-demands";
import { introductionModal } from "./community-introduction";
import { showIntroductionDirectory } from "./community-introduction-channel";
import { claimMaintainerHelp, openMaintainerHelpModal } from "./community-maintainer-retention";
import {
  assignMaintainerWork,
  connectMaintainerToLinear,
  exportMaintainerWorkToLinear,
  pauseMaintainerLinear,
  setMaintainerWorkStage,
  showMaintainerLinearMembers,
} from "./community-maintainer-work";
import { activateMaintainer, deactivateMaintainer } from "./community-maintainers";
import { openCommunityPalette } from "./community-palette";
import {
  openPastReviewModal,
  openPastReviewPickerModal,
  pastReviewBinding,
} from "./community-past-review";
import {
  openProductOwnerMention,
  openProductOwnerSpecialties,
} from "./community-product-owner-groups";
import { openQuickEntryModal } from "./community-quick-entry";
import { processRecordAction } from "./community-record-interactions";
import { type CommunityContext, ephemeral } from "./community-runtime";
import {
  applyTownhallRsvp,
  openTownhallEventModal,
  publishTownhallScheduleLink,
} from "./community-townhall-events";
import type { CommunityScope } from "./community-types";
import { date, InputError, object, string } from "./input";

type ActionInteraction = {
  readonly id: string;
  readonly action: Record<string, unknown>;
  readonly data: Record<string, unknown>;
  readonly scope: CommunityScope;
  readonly context: CommunityContext;
  readonly bugAnswerAction: ReturnType<typeof parseBugAnswerActionId>;
  readonly waitUntil: (promise: Promise<unknown>) => void;
};

export async function handleCommunityAction(input: ActionInteraction): Promise<Response> {
  const selected = input.action.selected_option
    ? object(input.action.selected_option).value
    : input.action.value;
  const value = object(JSON.parse(string(selected)));
  const ownerId = string(value.ownerId);
  const key = string(value.key);
  const resolvedOwnerId = ownerId === "actor" ? input.scope.userId : ownerId;
  if (
    !["community_shoutout", "community_introduction", "community_introduction_directory"].includes(
      input.id,
    ) &&
    resolvedOwnerId !== input.scope.userId
  )
    throw new InputError("본인 기록만 변경할 수 있어요.");
  let context = input.context;
  if (value.thread !== undefined || value.source !== undefined) {
    const thread = string(value.thread);
    const source = string(value.source);
    if (!/^\d+\.\d{6}$/.test(thread) || !/^\d+\.\d{6}$/.test(source))
      throw new InputError("기록 위치를 확인할 수 없어요.");
    context = { ...context, thread, source };
  }
  if (value.date !== undefined) context = { ...context, date: date(value.date) };
  if (input.id === "community_palette") {
    await openCommunityPalette(context, string(input.data.trigger_id), key);
    return new Response(null, { status: 200 });
  }
  if (input.id === "community_settings" || input.id === "community_group_settings") {
    await openSettings(
      context,
      string(input.data.trigger_id),
      input.id === "community_group_settings",
    );
    return new Response(null, { status: 200 });
  }
  if (input.id === "community_shoutout") {
    await openShoutout(
      context,
      string(input.data.trigger_id),
      ownerId === input.scope.userId ? null : ownerId,
    );
    return new Response(null, { status: 200 });
  }
  if (input.id === "community_introduction") {
    await introductionModal(context, string(input.data.trigger_id));
    return new Response(null, { status: 200 });
  }
  if (
    input.id === "community_event_open" ||
    input.id === "community_event_open_fixed" ||
    input.id === "community_event_open_poll"
  ) {
    await openTownhallEventModal(
      context,
      string(input.data.trigger_id),
      undefined,
      input.id === "community_event_open_poll" ? "poll" : "fixed",
    );
    return new Response(null, { status: 200 });
  }
  if (
    input.id === "community_event_demand_open" ||
    input.id === "community_event_host_request_open"
  ) {
    await openEventDemandModal(
      context,
      string(input.data.trigger_id),
      input.id === "community_event_demand_open" ? "validate" : "host_request",
    );
    return new Response(null, { status: 200 });
  }
  if (
    [
      "community_event_demand_host",
      "community_event_demand_edit",
      "community_event_demand_close",
    ].includes(input.id)
  ) {
    const demand = await getEventDemand(context, key);
    if (input.id === "community_event_demand_host")
      await openDemandHostingModal(context, string(input.data.trigger_id), demand);
    else if (input.id === "community_event_demand_edit")
      await openEventDemandModal(context, string(input.data.trigger_id), demand.mode, demand);
    else input.waitUntil(closeEventDemand(context, key));
    return new Response(null, { status: 200 });
  }
  if (input.id === "community_maintainer_activate") {
    input.waitUntil(
      activateMaintainer(context).catch(async (error: unknown) => {
        console.error(
          JSON.stringify({
            event: "community.maintainer.activation_failed",
            errorType: error instanceof Error ? error.name : "Unknown",
          }),
        );
        await ephemeral(context, {
          text:
            error instanceof InputError
              ? error.message
              : "Product Owner 참여를 완료하지 못했어요. 잠시 후 다시 눌러 주세요. 이미 받은 채널 초대는 다시 눌러도 중복되지 않습니다.",
        });
      }),
    );
    return new Response(null, { status: 200 });
  }
  if (input.id === "community_po_specialties_open") {
    await openProductOwnerSpecialties(context, string(input.data.trigger_id));
    return new Response(null, { status: 200 });
  }
  if (input.id === "community_po_mention_open") {
    await openProductOwnerMention(context, string(input.data.trigger_id));
    return new Response(null, { status: 200 });
  }
  if (input.id === "community_maintainer_deactivate") {
    input.waitUntil(
      (async () => {
        await pauseMaintainerLinear(context);
        await deactivateMaintainer(context);
      })().catch(async (error: unknown) => {
        console.error(
          JSON.stringify({
            event: "community.maintainer.deactivation_failed",
            errorType: error instanceof Error ? error.name : "Unknown",
          }),
        );
        await ephemeral(context, {
          text:
            error instanceof InputError
              ? error.message
              : "Product Owner 역할과 Linear 연결을 함께 정리하지 못했어요. 잠시 후 다시 시도해 주세요.",
        });
      }),
    );
    return new Response(null, { status: 200 });
  }
  if (input.id === "community_maintainer_linear_connect") {
    input.waitUntil(
      connectMaintainerToLinear(context).catch(async (error: unknown) => {
        console.error(
          JSON.stringify({
            event: "community.maintainer.linear_connect_failed",
            errorType: error instanceof Error ? error.name : "Unknown",
          }),
        );
        await ephemeral(context, {
          text:
            error instanceof InputError
              ? error.message
              : "Linear 연결을 확인하지 못했어요. 잠시 후 다시 눌러 주세요.",
        });
      }),
    );
    return new Response(null, { status: 200 });
  }
  if (input.id === "community_maintainer_linear_members") {
    input.waitUntil(showMaintainerLinearMembers(context));
    return new Response(null, { status: 200 });
  }
  if (input.id === "community_feedback_dri_select") {
    input.waitUntil(
      assignMaintainerWork(context, key, string(value.driUserId)).catch(async (error: unknown) => {
        console.error(
          JSON.stringify({
            event: "community.maintainer.dri_assignment_failed",
            errorType: error instanceof Error ? error.name : "Unknown",
          }),
        );
        await ephemeral(context, {
          text:
            error instanceof InputError
              ? error.message
              : "DRI 변경을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
        });
      }),
    );
    return new Response(null, { status: 200 });
  }
  if (input.id === "community_feedback_stage_select") {
    input.waitUntil(
      setMaintainerWorkStage(context, key, string(value.stage)).catch(async (error: unknown) => {
        console.error(
          JSON.stringify({
            event: "community.maintainer.stage_change_failed",
            errorType: error instanceof Error ? error.name : "Unknown",
          }),
        );
        await ephemeral(context, {
          text:
            error instanceof InputError
              ? error.message
              : "상태 변경을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
        });
      }),
    );
    return new Response(null, { status: 200 });
  }
  if (input.id === "community_work_linear_export") {
    input.waitUntil(
      exportMaintainerWorkToLinear(context, key).catch(async (error: unknown) => {
        console.error(
          JSON.stringify({
            event: "community.maintainer.linear_export_failed",
            errorType: error instanceof Error ? error.name : "Unknown",
          }),
        );
        await ephemeral(context, {
          text:
            error instanceof InputError
              ? error.message
              : "Linear 미러를 만들지 못했어요. Slack 작업은 그대로 유지됩니다.",
        });
      }),
    );
    return new Response(null, { status: 200 });
  }
  if (input.id.startsWith("community_maintainer_help_open_")) {
    const mode = value.mode;
    if (mode !== "question" && mode !== "qna" && mode !== "ot")
      throw new InputError("도움 요청 종류를 확인할 수 없어요.");
    await openMaintainerHelpModal(context, string(input.data.trigger_id), mode);
    return new Response(null, { status: 200 });
  }
  if (input.id === "community_maintainer_help_claim") {
    input.waitUntil(claimMaintainerHelp(context, string(value.requesterId)));
    return new Response(null, { status: 200 });
  }
  if (input.id === "community_linear_open") return new Response(null, { status: 200 });
  if (input.id === "community_chapter_open") {
    await openCommunityChapterModal(context, string(input.data.trigger_id));
    return new Response(null, { status: 200 });
  }
  if (
    input.id === "community_event_availability" ||
    input.id === "community_event_edit" ||
    input.id === "community_event_rsvp"
  ) {
    const event = await context.store.getTownhallEvent({
      teamId: input.scope.teamId,
      channelId: input.scope.channelId,
      actorId: input.scope.userId,
      eventId: key,
    });
    if (event?.status !== "active") throw new InputError("이벤트를 찾을 수 없어요.");
    if (input.id === "community_event_edit")
      await openTownhallEventModal(context, string(input.data.trigger_id), event);
    else if (input.id === "community_event_availability")
      await publishTownhallScheduleLink(context, event);
    else input.waitUntil(applyTownhallRsvp(context, event));
    return new Response(null, { status: 200 });
  }
  if (input.id === "community_past_review") {
    await openPastReviewModal(context, string(input.data.trigger_id), pastReviewBinding(value));
    return new Response(null, { status: 200 });
  }
  if (input.id === "community_past_review_list") {
    await openPastReviewPickerModal(context, string(input.data.trigger_id));
    return new Response(null, { status: 200 });
  }
  if (input.id === "community_quick_goal" || input.id === "community_quick_review") {
    await openQuickEntryModal(
      context,
      string(input.data.trigger_id),
      input.id === "community_quick_goal" ? "goal" : "review",
    );
    return new Response(null, { status: 200 });
  }
  const bugResponse = await handleBugAction(
    input.id,
    input.bugAnswerAction,
    context,
    key,
    value,
    input.data.trigger_id,
    input.waitUntil,
  );
  if (bugResponse) return bugResponse;
  if (input.id === "community_introduction_directory") {
    input.waitUntil(
      showIntroductionDirectory(context).catch((error: unknown) =>
        console.error(
          JSON.stringify({
            event: "community.introduction_directory.failed",
            type: error instanceof Error ? error.name : "Unknown",
          }),
        ),
      ),
    );
    return new Response(null, { status: 200 });
  }
  input.waitUntil(
    processRecordAction(context, input.id, key, value).catch(async (error: unknown) => {
      console.error(
        JSON.stringify({
          event: "community.action.failed",
          type: error instanceof Error ? error.name : "Unknown",
        }),
      );
      await ephemeral(context, {
        text:
          error instanceof InputError
            ? error.message
            : "처리를 확인하지 못했어요. 현재 상태를 확인해 주세요.",
      });
    }),
  );
  return new Response(null, { status: 200 });
}
