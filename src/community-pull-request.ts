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
): Promise<void> {
  const status = await context.store.maintainerStatus(context.scope.teamId, context.scope.userId);
  if (status?.state !== "active" && context.scope.userId !== context.env.COMMUNITY_ADMIN_ID)
    throw new InputError("활성 Product Owner 또는 Founder만 PR을 연결할 수 있어요.");
  await callSlack(context.env.SLACK_BOT_TOKEN, "views.open", {
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "community_pull_request_submit",
      private_metadata: metadata(context),
      title: { type: "plain_text", text: "내 PR 연결하기" },
      submit: { type: "plain_text", text: "검증 요청" },
      close: { type: "plain_text", text: "취소" },
      blocks: [
        {
          type: "input",
          block_id: "work_key",
          label: { type: "plain_text", text: "po-work 버그 키" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            placeholder: { type: "plain_text", text: "BUG-…" },
          },
        },
        {
          type: "input",
          block_id: "pull_url",
          label: { type: "plain_text", text: "Betalgeuse/ot1l PR URL" },
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

export async function readOpenPullRequest(
  pullUrl: string,
  request: typeof fetch = fetch,
): Promise<{ number: number; headSha: string; headRepository: string; paths: string[] }> {
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
  const workKey = modalValue(view, "work_key").toUpperCase();
  if (!/^BUG-[A-Z0-9]{8,32}$/.test(workKey))
    throw new InputError("po-work 버그 키를 확인해 주세요.");
  const pullUrl = modalValue(view, "pull_url");
  const pull = await readOpenPullRequest(pullUrl);
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
  await ephemeral(context, {
    text: `PR #${pull.number}을 ${workKey}에 연결했어요. 검사가 끝나면 po-work의 작업 스레드에 승인 버튼이 나타나요.`,
  });
}
