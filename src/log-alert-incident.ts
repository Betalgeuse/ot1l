import { DurableObject } from "cloudflare:workers";
import { CommunitySlackError, callSlack } from "./community-social";
import type { Json } from "./input";
import { type AlarmSignal, validAlarmSignal } from "./log-alert-observation";

type Env = { readonly SLACK_BOT_TOKEN: string; readonly COMMUNITY_SYS_ALERT_CHANNEL_ID: string };
type State = {
  key: string;
  cycleId: string;
  role: AlarmSignal["role"];
  version: string | null;
  canceledAt: number | null;
  completedAt: number | null;
  expiresAt: number;
  messageTs: string | null;
  posting: boolean;
  rendered: string | null;
  deliveryFailures: number;
};
const WAIT_MS = 10 * 60_000; // Two existing five-minute safety cycles; an alert window, not an SLA.
const RETAIN_MS = 7 * 86_400_000;
export function incidentStatus(
  s: Pick<State, "canceledAt" | "completedAt">,
  now: number,
): string | null {
  if (s.canceledAt === null) return null;
  if (s.completedAt !== null && s.completedAt >= s.canceledAt) return "recovered";
  return now >= s.canceledAt + WAIT_MS ? "unresolved" : "waiting";
}
function message(s: State, status: string): { text: string; blocks: Json[] } {
  const time = (value: number | null) =>
    value === null
      ? "미확인"
      : new Intl.DateTimeFormat("ko-KR", {
          timeZone: "Asia/Seoul",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(new Date(value));
  const label =
    status === "recovered"
      ? "예약 실행 완료 확인"
      : status === "unresolved"
        ? "예약 실행 복구 미확인"
        : "예약 실행 중단 · 복구 확인 중";
  const description =
    status === "recovered"
      ? "같은 실행의 종료 기록과 현재 처리 대상 큐에 미처리 항목이 없음을 확인했어요. 중단 원인까지 밝혀졌다는 뜻은 아닙니다."
      : status === "unresolved"
        ? "두 번의 정기 점검 간격 동안 같은 작업의 완료를 확인하지 못했어요. 운영 점검이 필요합니다."
        : "실행이 중단됐어요. 같은 작업의 완료 기록이 도착하면 이 메시지를 갱신합니다.";
  const icon = status === "recovered" ? "✅" : status === "unresolved" ? "🔴" : "🟡";
  return {
    text: `${label} · ${s.key.slice(0, 12)}`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: `${icon} ${label}` } },
      {
        type: "section",
        text: {
          type: "plain_text",
          text: `${s.role === "bug_delivery" ? "피드백 전달" : "회원·잔디 관리"}\n${description}`,
        },
      },
      {
        type: "context",
        block_id: `alarm_incident_${s.key}`,
        elements: [
          {
            type: "plain_text",
            text: `중단 ${time(s.canceledAt)} · 완료 ${time(s.completedAt)} KST\n참조 ${s.key.slice(0, 12)} · 중단 버전 ${s.version?.slice(0, 8) ?? "미확인"} · 원문·회원 정보 없음`,
          },
        ],
      },
    ],
  };
}
export class AlarmIncident extends DurableObject<Env> {
  private queue: Promise<void> = Promise.resolve();
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  observe(signal: AlarmSignal): Promise<boolean> {
    return this.serial(async () => {
      if (!validAlarmSignal(signal)) throw new Error("invalid_alarm_signal");
      const now = Date.now();
      const previous = await this.ctx.storage.get<State>("incident");
      const s: State = previous ?? {
        key: signal.key,
        cycleId: signal.cycleId,
        role: signal.role,
        version: signal.version,
        canceledAt: null,
        completedAt: null,
        expiresAt: now + RETAIN_MS,
        messageTs: null,
        posting: false,
        rendered: null,
        deliveryFailures: 0,
      };
      if (s.key !== signal.key || s.cycleId !== signal.cycleId || s.role !== signal.role)
        throw new Error("alarm_identity_mismatch");
      if (signal.phase === "canceled") {
        if (s.canceledAt === null || signal.at < s.canceledAt) s.version = signal.version;
        s.canceledAt = Math.min(s.canceledAt ?? signal.at, signal.at);
      } else s.completedAt = Math.max(s.completedAt ?? signal.at, signal.at);
      await this.ctx.storage.put("incident", s);
      return this.publish(s);
    });
  }
  async inspect(): Promise<State | undefined> {
    return this.ctx.storage.get<State>("incident");
  }
  alarm(): Promise<void> {
    return this.serial(async () => {
      const s = await this.ctx.storage.get<State>("incident");
      if (!s) return;
      if (Date.now() >= s.expiresAt) {
        await this.ctx.storage.delete("incident");
        await this.ctx.storage.deleteAlarm();
        return;
      }
      await this.publish(s);
    });
  }
  private async acceptedMessage(s: State): Promise<string | null> {
    const auth = await callSlack(this.env.SLACK_BOT_TOKEN, "auth.test", {});
    let cursor = "";
    for (let page = 0; page < 3; page++) {
      const history = await callSlack(this.env.SLACK_BOT_TOKEN, "conversations.history", {
        channel: this.env.COMMUNITY_SYS_ALERT_CHANNEL_ID,
        oldest: String(Math.max(0, (s.canceledAt ?? Date.now()) - 60_000) / 1000),
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      for (const m of (history.messages ?? []) as Array<Record<string, unknown>>) {
        if (
          m.user === auth.user_id &&
          typeof m.ts === "string" &&
          Array.isArray(m.blocks) &&
          m.blocks.some((b) => b.block_id === `alarm_incident_${s.key}`)
        )
          return m.ts;
      }
      const meta = history.response_metadata as Record<string, unknown> | undefined;
      cursor = typeof meta?.next_cursor === "string" ? meta.next_cursor : "";
      if (!cursor) break;
    }
    return null;
  }
  private async publish(s: State): Promise<boolean> {
    const now = Date.now(),
      status = incidentStatus(s, now);
    let wrote = false;
    // Persist the next wake-up before calling Slack; it also retries a lost response.
    await this.ctx.storage.setAlarm(Math.min(s.expiresAt, now + 60_000));
    try {
      if (status && s.rendered !== status) {
        const payload = message(s, status);
        if (s.posting && !s.messageTs) {
          s.messageTs = await this.acceptedMessage(s);
          if (!s.messageTs) throw new Error("alarm_alert_acceptance_unconfirmed");
        }
        if (s.messageTs)
          await callSlack(this.env.SLACK_BOT_TOKEN, "chat.update", {
            channel: this.env.COMMUNITY_SYS_ALERT_CHANNEL_ID,
            ts: s.messageTs,
            ...payload,
          });
        else {
          s.posting = true;
          await this.ctx.storage.put("incident", s);
          const response = await callSlack(this.env.SLACK_BOT_TOKEN, "chat.postMessage", {
            channel: this.env.COMMUNITY_SYS_ALERT_CHANNEL_ID,
            ...payload,
            unfurl_links: false,
            unfurl_media: false,
          });
          if (typeof response.ts !== "string" || !/^\d+\.\d+$/.test(response.ts))
            throw new Error("alarm_alert_receipt_missing");
          s.messageTs = response.ts;
        }
        s.posting = false;
        s.rendered = status;
        s.deliveryFailures = 0;
        await this.ctx.storage.put("incident", s);
        wrote = true;
      }
      const deadline =
        status === "waiting" && s.canceledAt !== null ? s.canceledAt + WAIT_MS : s.expiresAt;
      await this.ctx.storage.setAlarm(Math.min(s.expiresAt, Math.max(now + 1_000, deadline)));
      return wrote;
    } catch (error) {
      if (
        error instanceof CommunitySlackError &&
        [
          "rate_limited",
          "invalid_blocks",
          "invalid_arguments",
          "channel_not_found",
          "not_in_channel",
          "is_archived",
          "invalid_auth",
          "account_inactive",
        ].includes(error.code)
      )
        s.posting = false;
      s.deliveryFailures++;
      await this.ctx.storage.put("incident", s);
      const retryAfter =
        error instanceof CommunitySlackError
          ? Math.max(60_000, (error.retryAfterSeconds ?? 0) * 1000)
          : 60_000;
      const escalation = s.canceledAt === null ? s.expiresAt : s.canceledAt + WAIT_MS;
      await this.ctx.storage.setAlarm(
        s.deliveryFailures < 5
          ? Math.min(s.expiresAt, Date.now() + retryAfter)
          : escalation > Date.now()
            ? Math.min(s.expiresAt, escalation)
            : s.expiresAt,
      );
      throw error;
    }
  }
}
