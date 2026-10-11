import { MaintainerOpsStore } from "./community-maintainer-store";
import { setMaintainerWorkReleaseStage } from "./community-maintainer-work";
import { notificationThread } from "./community-notification-thread";
import type { CommunityEnv } from "./community-runtime";
import { callSlack } from "./community-social";
import { list, object, string } from "./input";
import { NeonStore } from "./store";

export function prMetadataStage(row: Record<string, unknown>): string | null {
  if (row.status === "draft") return "시안 검토 중 · Draft PR은 병합하지 않아요";
  if (row.status === "bound") return null; // Exact-SHA verifier owns subsequent stages.
  const reason =
    {
      github_rate_limited: "GitHub 조회 제한",
      github_unavailable: "GitHub 연결 오류",
      github_auth_required: "운영자의 GitHub 인증 갱신이 필요해요",
      github_forbidden: "운영자의 GitHub 조회 권한을 확인해 주세요",
      pr_not_open: "열려 있는 PR이 아니에요",
      pr_wrong_base: "대상 저장소 또는 main 브랜치를 확인해 주세요",
      pr_missing: "GitHub에서 PR을 찾지 못했어요",
      pr_too_large: "변경 경로가 100개를 넘어 별도 검토가 필요해요",
      pr_changed: "조회 중 PR이 변경됐어요",
      pr_invalid_metadata: "PR 정보를 완전히 확인하지 못했어요",
      actor_inactive: "요청자의 PO 권한을 확인해 주세요",
      binding_conflict: "이 작업에 이미 연결된 PR·실행을 확인해 주세요",
      lookup_interrupted: "조회 작업이 중단됐어요",
    }[String(row.error_code)] ?? "PR 정보 확인 대기";
  if (row.status === "rejected")
    return `PR 조회 중단 · ${reason} · 수정 후 검토를 다시 요청해 주세요`;
  return row.error_code ? `${reason} · 자동 재시도 대기 (${Number(row.attempt)}/3)` : reason;
}

export async function syncPrMetadataResults(env: CommunityEnv): Promise<void> {
  const db = new NeonStore(env.DATABASE_URL);
  const rows = list(
    await db.queryJson("SELECT otl.community_pr_metadata_results($1::jsonb)", [
      JSON.stringify({ teamId: env.SLACK_TEAM_ID }),
    ]),
  );
  for (const raw of rows) {
    const row = object(raw);
    if (
      row.status === "bound" &&
      typeof row.head_sha === "string" &&
      env.COMMUNITY_MAINTAINERS_CHANNEL_ID
    ) {
      const channel = env.COMMUNITY_MAINTAINERS_CHANNEL_ID;
      const ops = new MaintainerOpsStore(env);
      const surface = await ops.execute("surface_get", {
        workKey: string(row.work_key),
        channelId: channel,
      });
      const work = await ops.getWork(string(row.work_key));
      const thread = typeof surface === "string" ? surface : work?.source_thread;
      if (typeof thread === "string") {
        for (const reply of (await notificationThread(env.SLACK_BOT_TOKEN, channel, thread)) ??
          []) {
          if (!reply.bot_id) continue;
          const controls = list(reply.blocks ?? [])
            .map(object)
            .flatMap((b) => list(b.elements ?? []).map(object));
          const stale = controls.some((control) => {
            if (
              control.action_id !== "community_feedback_merge_approve" ||
              typeof control.value !== "string"
            )
              return false;
            try {
              const binding = object(JSON.parse(control.value));
              return (
                binding.key === row.work_key &&
                binding.prNumber === Number(row.pr_number) &&
                binding.headSha !== row.head_sha
              );
            } catch {
              return false;
            }
          });
          if (stale)
            await callSlack(env.SLACK_BOT_TOKEN, "chat.update", {
              channel,
              ts: string(reply.ts),
              text: "새 수정본을 검증하고 있어요. 이전 승인 버튼은 종료됐습니다.",
              blocks: [],
            });
        }
      }
    }
    const stage = prMetadataStage(row);
    if (stage) await setMaintainerWorkReleaseStage(env, string(row.work_key), stage);
    await db.queryJson("SELECT otl.community_pr_metadata_results($1::jsonb)", [
      JSON.stringify({
        teamId: env.SLACK_TEAM_ID,
        operation: "ack",
        requestId: row.request_id,
        revision: row.revision,
      }),
    ]);
  }
}
