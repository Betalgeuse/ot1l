// Historical transport and encrypted-outbox characterization. Not shipped in the Worker.
import { replayBugDelivery } from "../src/community-bug-delivery-replay";
import { claimBugTextEntry, finishBugTextEntry, startBugTextEntry } from "../src/community-bug-entry-session";
import { parseBugIntakeCandidate } from "../src/community-bug-intent";
import { digestBugText } from "../src/community-bug-private";
import { bugReportCandidates } from "../src/community-bug-report";
import { continueBugReport } from "../src/community-bug-session";
import { startBugReport } from "../src/community-bug-start";
import { type CommunityContext, textReply } from "../src/community-runtime";
/** Historical delivery characterization only; no Slack router calls this entry point. */
export async function handleLegacyBugReportMessage(
  context: CommunityContext,
  text: string,
): Promise<boolean> {
  const initialIntent = parseBugIntakeCandidate(
    text,
    [context.env.COMMUNITY_CHANNEL_ID, context.env.COMMUNITY_FEEDBACK_CHANNEL_ID].includes(
      context.scope.channelId,
    ),
  );
  const shouldInspectEntry =
    context.thread !== context.source &&
    (context.bugTextEntryState === undefined
      ? initialIntent === null
      : context.bugTextEntryState !== "missing");
  if (shouldInspectEntry) {
    const session = await claimBugTextEntry(context);
    if (session === "active") {
      const message = { id: context.source, text: text.trim(), at: new Date().toISOString() };
      try {
        await startBugReport(context, {
          messages: [message],
          candidates: bugReportCandidates(message.id, message.text),
        });
        await finishBugTextEntry(context, "sent");
      } catch (error) {
        await finishBugTextEntry(context, "failed");
        throw error;
      }
      return true;
    }
    if (session === "expired") {
      await textReply(
        context,
        "버그 제보 입력 시간이 지났어요. 새 메시지로 ‘버그제보’라고 알려주세요.",
      );
      return true;
    }
    if (session === "consumed") {
      if (await continueBugReport(context, text)) return true;
      await textReply(
        context,
        "이 입력은 이미 처리했어요. 진행 중인 질문에 답하거나 ‘버그 제보 계속’이라고 알려주세요.",
      );
      return true;
    }
  }
  const intent = initialIntent;
  if (!intent) return false;
  if (intent.kind === "entry") {
    await startBugTextEntry(context, await digestBugText(text));
    await textReply(context, "어떤 문제가 발생했나요? 이 스레드에 메시지로 알려주세요.");
    return true;
  }
  const report = intent.report;
  const message = { id: context.source, text: report, at: new Date().toISOString() };
  const candidates = bugReportCandidates(message.id, report);
  await startBugReport(context, { messages: [message], candidates });
  return true;
}
