import assert from "node:assert/strict";
import { buildBoard } from "../src/board.ts";
import { communityStatusMessage } from "../src/community-messages.ts";
import { parseInterpretation } from "../src/intent.ts";
import { parseReflectionHeader } from "../src/reflection-header.ts";

const palette = { empty: "#EBEDF0", written: "#9BE9A8", complete: "#216E39" };
const board = buildBoard(
  {
    startDate: "2026-09-28",
    palette,
    goals: [
      { date: "2026-09-28", text: "결과", completed: true, outcome: "complete" },
      { date: "2026-09-29", text: "탐색", completed: true, outcome: "progress" },
      { date: "2026-09-30", text: "일부", completed: false, outcome: "partial" },
      { date: "2026-10-01", text: "미완", completed: false, outcome: "not_done" },
    ],
  },
  "2026-10-01",
);
assert.equal(board.cells.find((cell) => cell.date === "2026-09-28")?.status, "complete");
assert.equal(board.cells.find((cell) => cell.date === "2026-09-29")?.status, "complete");
assert.equal(board.cells.find((cell) => cell.date === "2026-09-30")?.status, "written");
assert.equal(board.cells.find((cell) => cell.date === "2026-10-01")?.status, "empty");

const card = communityStatusMessage({
  userId: "UQA",
  date: "2026-09-29",
  goal: "탐색안 검증",
  outcome: "progress",
  reflection: "접근법 두 개를 검증해 하나를 버리고 다음 행동을 정했어요.",
  rest: false,
  undoValue: null,
});
assert.match(card.text, /의미 있는 진전/);

const progressHeader = parseReflectionHeader(
  "후기: 진전. 접근법 두 개를 검증해 하나를 버리고 다음 행동을 정했어요.",
  "2026-09-30",
);
assert.equal(progressHeader?.outcome, "progress");
assert.equal(progressHeader?.text, "접근법 두 개를 검증해 하나를 버리고 다음 행동을 정했어요.");
assert.deepEqual(parseInterpretation({ intent: "reflection", outcome: "progress" }), {
  intent: "reflection",
  outcome: "progress",
});
assert.deepEqual(parseInterpretation({ intent: "reflection", outcome: "effort" }), {
  intent: "unclear",
  outcome: "unknown",
});

console.log(
  "PASS meaningful progress: explicit uncertainty reduction stays distinct while garden maps progress/partial/not-done to green/light/gray",
);
