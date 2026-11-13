import { slackMention } from "./community-messages";
import { requireCommunityAdmin } from "./community-permissions";
import { type CommunityContext, textReply } from "./community-runtime";

export async function adminCommand(context: CommunityContext, text: string): Promise<boolean> {
  if (!["회원 현황"].includes(text.trim())) return false;
  requireCommunityAdmin(context.scope, context.env);
  switch (text.trim()) {
    case "회원 현황": {
      const days = await context.store.listDays(
        context.scope.teamId,
        context.env.COMMUNITY_PUBLIC_CHANNEL_ID ?? context.scope.channelId,
        context.date,
      );
      const labels = {
        pending: "완료 여부 미확인",
        complete: "완료",
        progress: "의미 있는 진전",
        partial: "부분 완료",
        not_done: "미수행",
      } as const;
      const rows = days.map(
        (day) =>
          `${slackMention(day.userId)} · *ONE THING* ${day.goal ? "등록" : "미등록"} · ${day.resting ? "휴식" : labels[day.outcome]} · 후기 ${day.reflection ? "제출" : "미제출"}`,
      );
      await textReply(
        context,
        `${context.date} 회원 현황\n${rows.join("\n") || "아직 기록한 회원이 없어요."}`,
      );
      return true;
    }
    default:
      return false;
  }
}
