import { bugCandidate } from "./community-bug-facts";
import { startBugReport } from "./community-bug-start";
import { fallbackFeedbackAnalysis } from "./community-feedback";
import { MaintainerOpsStore } from "./community-maintainer-store";
import {
  refreshMaintainerWorkSurfaces,
  setMaintainerWorkReleaseStage,
} from "./community-maintainer-work";

import { type CommunityContext, ephemeral } from "./community-runtime";
import { callSlack } from "./community-social";
import { InputError, object, string } from "./input";
import { NeonStore } from "./store";

const PULL_URL = /^https:\/\/github[.]com\/Betalgeuse\/ot1l\/pull\/([1-9]\d*)$/;

function metadata(context: CommunityContext): string {
  return JSON.stringify({
    channelId: context.scope.channelId,
    userId: context.scope.userId,
    source: context.source,
    thread: context.thread,
    date: context.date,
  });
}

export async function openPullRequestBindingModal(
  context: CommunityContext,
  triggerId: string,
  workKey?: string,
): Promise<void> {
  const status = await context.store.maintainerStatus(context.scope.teamId, context.scope.userId);
  if (status?.state !== "active" && context.scope.userId !== context.env.COMMUNITY_ADMIN_ID)
    throw new InputError("활성 Product Owner 또는 Founder만 PR을 연결할 수 있어요.");
  await callSlack(context.env.SLACK_BOT_TOKEN, "views.open", {
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "community_pull_request_submit",
      private_metadata: JSON.stringify({ ...JSON.parse(metadata(context)), workKey }),
      title: { type: "plain_text", text: "직접 만든 PR 검토" },
      submit: { type: "plain_text", text: "검증 요청" },
      close: { type: "plain_text", text: "취소" },
      blocks: [
        {
          type: "section",
          text: {
            type: "plain_text",
            text: workKey
              ? "내 개발환경에서 이미 만든 PR을 이 작업에 연결합니다. OT1L에 AI 수정을 맡겼다면 이 화면은 필요 없어요. Draft는 검토만 하며 병합하지 않습니다."
              : "내 개발환경(내 AI 도구 포함)에서 수정하고 GitHub에 만든 PR 주소를 넣으세요. OT1L이 만드는 PR은 자동 연결됩니다. Draft는 검토만 합니다.",
          },
        },
        {
          type: "input",
          block_id: "pull_url",
          label: { type: "plain_text", text: "GitHub PR 주소 (대상: Betalgeuse/ot1l)" },
          element: { type: "url_text_input", action_id: "value" },
        },
      ],
    },
  });
}

function modalValue(view: Record<string, unknown>, blockId: string): string {
  const block = object(object(object(view.state).values)[blockId]);
  return string(object(block.value).value).trim();
}

export function pullRequestFormErrors(
  view: Record<string, unknown>,
): Readonly<Record<string, string>> | null {
  try {
    const match = PULL_URL.exec(modalValue(view, "pull_url"));
    if (match && Number.isSafeInteger(Number(match[1]))) return null;
  } catch {
    // Keep malformed or missing input in the modal, before any external request.
  }
  return { pull_url: "https://github.com/Betalgeuse/ot1l/pull/번호 형식의 PR 주소를 넣어 주세요." };
}

export async function submitPullRequestBinding(
  context: CommunityContext,
  view: Record<string, unknown>,
): Promise<void> {
  const status = await context.store.maintainerStatus(context.scope.teamId, context.scope.userId);
  if (status?.state !== "active" && context.scope.userId !== context.env.COMMUNITY_ADMIN_ID)
    throw new InputError("활성 Product Owner 또는 Founder만 PR을 연결할 수 있어요.");
  const privateMetadata = object(
    JSON.parse(typeof view.private_metadata === "string" ? view.private_metadata : "{}"),
  );
  let workKey = typeof privateMetadata.workKey === "string" ? privateMetadata.workKey : "";
  if (!workKey && object(object(view.state).values).work_key)
    workKey = modalValue(view, "work_key");
  const pullUrl = modalValue(view, "pull_url");
  const match = PULL_URL.exec(pullUrl);
  if (!match || !Number.isSafeInteger(Number(match[1])))
    throw new InputError("올바른 PR 주소를 넣어 주세요.");
  const pull = { number: Number(match[1]), title: `직접 만든 PR #${match[1]} 검증·검토` };
  const store = new MaintainerOpsStore(context.env);
  const existing = await store.execute("work_by_pr", { prNumber: pull.number });
  if (!workKey && existing && typeof existing === "object" && !Array.isArray(existing))
    workKey = string(object(existing).work_key);
  if (!workKey) {
    const actual = `PR #${pull.number} 검토 요청: ${pullUrl}`;
    const expected = pull.title;
    const messages = [
      { id: "form:actual", text: actual, at: new Date().toISOString() },
      { id: "form:expected", text: expected, at: new Date().toISOString() },
    ];
    const created = await startBugReport(
      { ...context, key: `direct-pr:${pull.number}` },
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
    workKey = created.draft.bugId;
  }
  if (!/^BUG-[A-Z0-9]{8,32}$/.test(workKey)) throw new InputError("연결할 작업을 확인해 주세요.");
  if (!(await store.getWork(workKey))) throw new InputError("연결할 작업을 찾을 수 없어요.");
  await store.execute(
    "work_pr",
    { workKey, prNumber: pull.number, prUrl: pullUrl },
    context.scope.userId,
  );
  const result = object(
    await new NeonStore(context.env.DATABASE_URL).queryJson(
      "SELECT otl.community_queue_pr_metadata($1::jsonb)",
      [
        JSON.stringify({
          teamId: context.scope.teamId,
          actorId: context.scope.userId,
          founderId: context.env.COMMUNITY_ADMIN_ID,
          workKey,
          prNumber: pull.number,
        }),
      ],
    ),
  );
  if (result.accepted !== true)
    throw new InputError("이 작업의 실행 상태를 확인한 뒤 다시 요청해 주세요.");
  await setMaintainerWorkReleaseStage(context.env, workKey, "PR 정보 확인 대기");
  await refreshMaintainerWorkSurfaces(context.env, workKey);
  await ephemeral(context, {
    text: `PR #${pull.number} 검토 요청을 저장했어요. GenQuant가 GitHub 정보를 조회하고 재시도합니다. 검증 후 같은 작업 스레드에 승인 버튼이 나타나요. Draft는 시안 검토만 합니다.`,
  });
}
