import { handleBugView } from "./community-bug-interactions";
import { createCommunityChapter, parseCommunityChapter } from "./community-chapters";
import { armCommunityClock } from "./community-clock";
import { readSettings } from "./community-controls";
import { parseEventDemand, submitEventDemand } from "./community-event-demands";
import { parseIntroduction, submitIntroduction } from "./community-introduction";
import { submitMaintainerHelp } from "./community-maintainer-retention";
import { escapeSlackText } from "./community-messages";
import { submitCommunityPalette } from "./community-palette";
import { parsePastReviewSubmission, pastReviewChange } from "./community-past-review";
import { submitPoSpecialties, submitPoSummon } from "./community-po-groups";
import { parseQuickEntrySubmission, submitQuickEntry } from "./community-quick-entry";
import { applyChange } from "./community-records";
import { type CommunityContext, type CommunityEnv, ephemeral, post } from "./community-runtime";
import type { CommunityStore } from "./community-store";
import {
  parseTownhallAvailability,
  parseTownhallEvent,
  submitTownhallAvailability,
  submitTownhallEvent,
} from "./community-townhall-events";
import type { CommunityScope } from "./community-types";
import { InputError, object, string } from "./input";

type ViewInteraction = {
  readonly id: string;
  readonly view: Record<string, unknown>;
  readonly metadata: Record<string, unknown>;
  readonly context: CommunityContext;
  readonly store: CommunityStore;
  readonly scope: CommunityScope;
  readonly env: CommunityEnv;
  readonly thread: string;
  readonly waitUntil: (promise: Promise<unknown>) => void;
};

export async function handleCommunityView(input: ViewInteraction): Promise<Response> {
  const bugResponse = await handleBugView(input.id, input.view, input.context, input.waitUntil);
  if (bugResponse) return bugResponse;
  if (input.id === "community_po_specialties_submit") {
    input.waitUntil(submitPoSpecialties(input.context, input.view));
    return Response.json({ response_action: "clear" });
  }
  if (input.id === "community_po_summon_submit") {
    const errors = await submitPoSummon(input.context, input.view);
    return errors
      ? Response.json({ response_action: "errors", errors })
      : Response.json({ response_action: "clear" });
  }
  if (input.id === "community_introduction_submit") {
    const parsed = parseIntroduction(object(input.view.state).values);
    if ("errors" in parsed)
      return Response.json({ response_action: "errors", errors: parsed.errors });
    const revision = Number(input.metadata.revision);
    if (!Number.isSafeInteger(revision) || revision < 0)
      throw new InputError("자기소개 버전을 확인할 수 없어요.");
    input.waitUntil(submitIntroduction(input.context, string(input.view.id), parsed, revision));
    return Response.json({ response_action: "clear" });
  }
  if (input.id === "community_maintainer_help_submit") {
    const mode = input.metadata.mode;
    if (mode !== "question" && mode !== "qna" && mode !== "ot")
      throw new InputError("도움 요청 종류를 확인할 수 없어요.");
    input.waitUntil(submitMaintainerHelp(input.context, input.view, mode));
    return Response.json({ response_action: "clear" });
  }
  if (input.id === "community_event_submit") {
    const scheduleMode = string(input.metadata.scheduleMode) as
      | "fixed"
      | "poll"
      | "edit"
      | "edit-fixed";
    if (!["fixed", "poll", "edit", "edit-fixed"].includes(scheduleMode))
      throw new InputError("이벤트 일정 방식을 확인할 수 없어요.");
    const parsed = parseTownhallEvent(input.view, scheduleMode);
    if ("errors" in parsed)
      return Response.json({ response_action: "errors", errors: parsed.errors });
    input.waitUntil(
      submitTownhallEvent(input.context, string(input.view.id), parsed, input.metadata),
    );
    return Response.json({ response_action: "clear" });
  }
  if (input.id === "community_event_demand_submit") {
    const mode = string(input.metadata.mode) as "validate" | "host_request";
    if (!["validate", "host_request"].includes(mode))
      throw new InputError("수요 방식을 확인할 수 없어요.");
    const parsed = parseEventDemand(input.view, mode);
    if ("errors" in parsed)
      return Response.json({ response_action: "errors", errors: parsed.errors });
    input.waitUntil(
      submitEventDemand(input.context, string(input.view.id), parsed, input.metadata),
    );
    return Response.json({ response_action: "clear" });
  }
  if (input.id === "community_chapter_submit") {
    const parsed = parseCommunityChapter(input.view);
    if ("errors" in parsed)
      return Response.json({ response_action: "errors", errors: parsed.errors });
    input.waitUntil(createCommunityChapter(input.context, parsed));
    return Response.json({ response_action: "clear" });
  }
  if (input.id === "community_event_availability_submit") {
    const selected = parseTownhallAvailability(input.view);
    input.waitUntil(
      submitTownhallAvailability(input.context, string(input.metadata.eventId), selected),
    );
    return Response.json({ response_action: "clear" });
  }
  if (input.id === "community_past_review_submit") {
    const parsed = parsePastReviewSubmission(input.view);
    if ("errors" in parsed)
      return Response.json({ response_action: "errors", errors: parsed.errors });
    const current = await input.store.day({ ...input.scope, date: parsed.date });
    if (
      current.revision !== parsed.revision ||
      !current.goal.trim() ||
      current.resting ||
      (current.outcome !== "pending" && current.reflection.trim())
    )
      return Response.json({
        response_action: "errors",
        errors: { reflection: "이미 정리됐거나 그 뒤에 바뀐 기록이에요." },
      });
    input.waitUntil(
      applyChange({ ...input.context, date: parsed.date }, pastReviewChange(input.context, parsed)),
    );
    return Response.json({ response_action: "clear" });
  }
  if (input.id === "community_quick_goal_submit" || input.id === "community_quick_review_submit") {
    const parsed = parseQuickEntrySubmission(input.view);
    if ("errors" in parsed)
      return Response.json({ response_action: "errors", errors: parsed.errors });
    const current = await input.store.day({ ...input.scope, date: parsed.date });
    if (current.revision !== parsed.revision)
      return Response.json({
        response_action: "errors",
        errors: { text: "그 사이 기록이 바뀌었어요. 닫고 다시 열어 주세요." },
      });
    input.waitUntil(submitQuickEntry(input.context, string(input.view.id), parsed));
    return Response.json({ response_action: "clear" });
  }
  if (input.id === "community_palette_submit")
    return submitCommunityPalette(input.context, input.view, input.waitUntil);
  if (input.id === "community_settings_submit" || input.id === "community_group_submit") {
    const prefs = readSettings(input.view, input.id === "community_group_submit");
    if ("errors" in prefs)
      return Response.json({ response_action: "errors", errors: prefs.errors });
    input.waitUntil(
      (async () => {
        if (input.id === "community_group_submit")
          await input.store.setGroupSchedule(input.scope, prefs);
        else await input.store.preferences(input.scope, prefs);
        await armCommunityClock(input.env, input.scope.channelId);
        await ephemeral(input.context, {
          text: `설정 저장! ONE THING ${prefs.goalTime} · 후기 ${prefs.reviewTime} · ${prefs.enabled ? "켜짐" : "꺼짐"} (한국 시간)`,
        });
      })(),
    );
    return Response.json({ response_action: "clear" });
  }
  if (input.id === "community_shoutout_submit") {
    const values = object(object(input.view.state).values);
    const target = string(object(object(values.target).value).selected_user);
    const text = string(object(object(values.message).value).value).trim();
    if (target === input.scope.userId)
      return Response.json({
        response_action: "errors",
        errors: { target: "자신 말고 응원할 동료를 골라주세요." },
      });
    if (!/^[UW][A-Z0-9]+$/.test(target) || !text || text.length > 500)
      return Response.json({
        response_action: "errors",
        errors: { message: "응원을 1~500자로 적어 주세요." },
      });
    const eligibleMembers = await input.store.members(input.scope.teamId, input.scope.channelId);
    if (!eligibleMembers.includes(input.scope.userId) || !eligibleMembers.includes(target))
      return Response.json({
        response_action: "errors",
        errors: { target: "지금 응원할 수 있는 동료를 골라주세요." },
      });
    input.waitUntil(
      (async () => {
        const key = `shoutout:${input.view.id}`;
        await input.store.putRecord({
          ...input.scope,
          key,
          kind: "shoutout",
          body: {
            target,
            text,
            date: input.context.date,
            source: input.context.source,
            thread: input.thread,
          },
        });
        if (!(await input.store.claimRecord({ ...input.scope, key }))) return;
        await post(input.context, {
          text: `<@${input.scope.userId}> → <@${target}>\n${escapeSlackText(text)}`,
        });
        await input.store.finishRecord({ ...input.scope, key }, "sent");
      })(),
    );
    return Response.json({ response_action: "clear" });
  }
  throw new InputError("지원하지 않는 화면입니다.");
}
