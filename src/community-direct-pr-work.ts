// The one place where the deploy approval path still creates a work item through the bug
// intake machinery. A direct PR with no existing OT1L work needs a work key before the
// Deployment Broker can verify it, and the database only accepts keys made by a bug draft.
// Replace this file with a purpose-built work creator before the bug intake files are deleted.
import { bugCandidate } from "./community-bug-facts";
import { startBugReport } from "./community-bug-start";
import { fallbackFeedbackAnalysis } from "./community-feedback";
import type { CommunityContext } from "./community-runtime";

export async function createDirectPrWork(
  context: CommunityContext,
  prNumber: number,
  title: string,
  pullUrl: string,
): Promise<string> {
  const actual = `PR #${prNumber} 검토 요청: ${pullUrl}`;
  const expected = title;
  const messages = [
    { id: "form:actual", text: actual, at: new Date().toISOString() },
    { id: "form:expected", text: expected, at: new Date().toISOString() },
  ];
  const created = await startBugReport(
    { ...context, key: `direct-pr:${prNumber}` },
    {
      messages,
      candidates: [
        bugCandidate("actual", "form:actual", actual),
        bugCandidate("expected", "form:expected", expected),
      ],
    },
    fallbackFeedbackAnalysis({ actual, expected }),
    "manual",
  );
  return created.draft.bugId;
}
