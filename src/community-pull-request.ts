import { bugCandidate } from "./community-bug-facts";
import { startBugReport } from "./community-bug-start";
import { fallbackFeedbackAnalysis } from "./community-feedback";
import { MaintainerOpsStore } from "./community-maintainer-store";
import {
  refreshMaintainerWorkSurfaces,
  setMaintainerWorkReleaseStage,
} from "./community-maintainer-work";
import { notificationThread } from "./community-notification-thread";
import { type CommunityContext, ephemeral } from "./community-runtime";
import { callSlack } from "./community-social";
import { InputError, list, object, string } from "./input";
import { NeonStore } from "./store";

const PULL_URL = /^https:\/\/github[.]com\/Betalgeuse\/ot1l\/pull\/([1-9]\d*)$/;

async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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

export async function readOpenPullRequest(
  pullUrl: string,
  request: typeof fetch = fetch,
): Promise<{
  number: number;
  headSha: string;
  headRepository: string;
  paths: string[];
  title: string;
  draft: boolean;
}> {
  const match = PULL_URL.exec(pullUrl);
  if (!match)
    throw new InputError(
      "https://github.com/Betalgeuse/ot1l/pull/{number} 형식만 사용할 수 있어요.",
    );
  const number = Number(match[1]);
  const headers = { accept: "application/vnd.github+json", "user-agent": "otl1-po-work" };
  const response = await request(`https://api.github.com/repos/Betalgeuse/ot1l/pulls/${number}`, {
    headers,
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) throw new InputError("GitHub에서 PR을 확인할 수 없어요.");
  const pull = object(await response.json());
  const head = object(pull.head);
  const repository = object(head.repo);
  if (
    pull.state !== "open" ||
    object(pull.base).ref !== "main" ||
    object(object(pull.base).repo).full_name !== "Betalgeuse/ot1l"
  )
    throw new InputError("열려 있고 base가 main인 PR만 연결할 수 있어요.");
  if (
    typeof repository.full_name !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository.full_name)
  )
    throw new InputError("PR의 원본 저장소를 확인할 수 없어요.");
  const headSha = string(head.sha);
  if (!/^[a-f0-9]{40}$/.test(headSha)) throw new InputError("PR head SHA를 확인할 수 없어요.");
  const filesResponse = await request(
    `https://api.github.com/repos/Betalgeuse/ot1l/pulls/${number}/files?per_page=100`,
    { headers, signal: AbortSignal.timeout(6000) },
  );
  if (!filesResponse.ok) throw new InputError("GitHub에서 PR 변경 파일을 확인할 수 없어요.");
  const files = list(await filesResponse.json());
  if (
    files.length < 1 ||
    files.length > 100 ||
    files.some((file) => typeof object(file).filename !== "string")
  )
    throw new InputError("PR 전체 변경 경로를 한 번에 검증할 수 없어요.");
  const link = filesResponse.headers.get("link") ?? "";
  if (/rel="next"/.test(link)) throw new InputError("변경 파일이 100개를 넘어 연결할 수 없어요.");
  return {
    number,
    title: typeof pull.title === "string" ? pull.title.slice(0, 1000) : `PR #${number}`,
    draft: pull.draft === true,
    headSha,
    headRepository: string(repository.full_name),
    paths: files.map((file) => string(object(file).filename)).sort(),
  };
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
  const pull = await readOpenPullRequest(pullUrl);
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
  if (pull.draft) {
    await setMaintainerWorkReleaseStage(context.env, workKey, "시안 검토 중");
    await ephemeral(context, {
      text: `Draft PR #${pull.number}을 시안 검토로 연결했어요. 자동 병합·배포는 시작하지 않습니다.`,
    });
    return;
  }
  const pathsDigest = await sha256Hex(JSON.stringify(pull.paths));
  const result = object(
    await new NeonStore(context.env.DATABASE_URL).queryJson(
      "SELECT otl.community_bind_pull_request($1::jsonb)",
      [
        JSON.stringify({
          teamId: context.scope.teamId,
          actorId: context.scope.userId,
          founderId: context.env.COMMUNITY_ADMIN_ID,
          workKey,
          pullUrl,
          ...pull,
          pathsDigest,
        }),
      ],
    ),
  );
  if (result.accepted !== true)
    throw new InputError(
      result.reason === "automatic_work_running"
        ? "봇이 이미 수정 중이에요. 실행이 끝난 뒤 PR을 연결해 주세요."
        : "이미 검증·승인 중인 PR이 있거나, 연결할 수 없는 작업이에요.",
    );
  if (result.headShaChanged === true) {
    const work = await store.getWork(workKey);
    const channel = context.env.COMMUNITY_MAINTAINERS_CHANNEL_ID;
    const surface = channel
      ? await store.execute("surface_get", { workKey, channelId: channel })
      : null;
    const thread = typeof surface === "string" ? surface : work?.source_thread;
    if (channel && typeof thread === "string") {
      const replies = await notificationThread(context.env.SLACK_BOT_TOKEN, channel, thread);
      for (const reply of replies ?? []) {
        if (!reply.bot_id) continue;
        const controls = list(reply.blocks ?? [])
          .map(object)
          .flatMap((block) => list(block.elements ?? []).map(object));
        const outdated = controls.some((control) => {
          if (
            control.action_id !== "community_feedback_merge_approve" ||
            typeof control.value !== "string"
          )
            return false;
          try {
            const binding = object(JSON.parse(control.value));
            return (
              binding.key === workKey &&
              binding.prNumber === pull.number &&
              binding.headSha !== pull.headSha
            );
          } catch {
            return false;
          }
        });
        if (outdated)
          await callSlack(context.env.SLACK_BOT_TOKEN, "chat.update", {
            channel,
            ts: string(reply.ts),
            text: "새 수정본을 검증하고 있어요. 이전 승인 버튼은 종료됐습니다.",
            blocks: [],
          });
      }
    }
  }
  await refreshMaintainerWorkSurfaces(context.env, workKey);
  await ephemeral(context, {
    text: `PR #${pull.number}을 ${workKey}에 연결했어요. 검사가 끝나면 po-work의 작업 스레드에 승인 버튼이 나타나요.`,
  });
}
