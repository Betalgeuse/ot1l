import { replayBugDelivery } from "./community-bug-delivery-replay";
import { bugCandidate } from "./community-bug-facts";
import { isBugReportMessage, parseBugIntakeCandidate } from "./community-bug-intent";
import { confirmBugReport, continueBugReport } from "./community-bug-session";
import { bugEntryPayload, openBugReportModal, parseBugReportModal } from "./community-bug-slack";
import { startBugReport } from "./community-bug-start";
import { fallbackFeedbackAnalysis } from "./community-feedback";
import { type CommunityContext, post } from "./community-runtime";
import { object } from "./input";

export {
  confirmBugReport,
  continueBugReport,
  isBugReportMessage,
  openBugReportModal,
  parseBugIntakeCandidate,
  parseBugReportModal,
  replayBugDelivery,
};

export async function submitBugReportModal(
  context: CommunityContext,
  values: unknown,
): Promise<Readonly<Record<string, string>> | null> {
  const parsed = parseBugReportModal(values);
  if ("errors" in parsed) return parsed.errors;
  const submittedFields = object(values);
  const compactFeedback = !["steps", "location", "occurredAt", "frequency", "impact"].some(
    (field) => submittedFields[field] !== undefined,
  );
  const actual = parsed.messages.find((message) => message.id === "form:actual")?.text ?? "";
  const expected = parsed.messages.find((message) => message.id === "form:expected")?.text ?? "";
  const analysis = compactFeedback ? fallbackFeedbackAnalysis({ actual, expected }) : undefined;
  await startBugReport(context, parsed, analysis);
  return null;
}

export async function handleBugReportMessage(
  context: CommunityContext,
  text: string,
): Promise<boolean> {
  const intent = parseBugIntakeCandidate(
    text,
    [context.env.COMMUNITY_CHANNEL_ID, context.env.COMMUNITY_FEEDBACK_CHANNEL_ID].includes(
      context.scope.channelId,
    ),
  );
  if (!intent) return false;
  if (intent.kind === "entry") {
    await post(context, bugEntryPayload(context));
    return true;
  }
  const actual = intent.report;
  await startBugReport(
    context,
    {
      messages: [{ id: "form:actual", text: actual, at: new Date().toISOString() }],
      candidates: [bugCandidate("actual", "form:actual", actual)],
    },
    fallbackFeedbackAnalysis({ actual, expected: "" }),
  );
  return true;
}
