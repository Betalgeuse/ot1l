import { callSlack } from "./community-social";

type LogAlertEnv = {
  readonly SLACK_BOT_TOKEN: string;
  readonly COMMUNITY_SYS_ALERT_CHANNEL_ID: string;
  readonly ALERT_RATE_LIMITER: {
    limit(input: { readonly key: string }): Promise<{ readonly success: boolean }>;
  };
};

type SafeIncident = {
  readonly script: string;
  readonly kind: string;
  readonly outcome: string;
  readonly status: number | null;
  readonly exceptionCount: number;
  readonly truncated: boolean;
};

function fetchDetails(event: TraceItem["event"]): {
  readonly kind: string;
  readonly status: number | null;
} {
  if (event && "request" in event) return { kind: "HTTP", status: event.response?.status ?? null };
  if (event && "cron" in event) return { kind: "Cron", status: null };
  if (event && "queue" in event) return { kind: "Queue", status: null };
  if (event && "scheduledTime" in event) return { kind: "Alarm", status: null };
  if (event && "rpcMethod" in event) return { kind: "RPC", status: null };
  return { kind: "기타", status: null };
}

export function safeLogIncident(trace: TraceItem): SafeIncident | null {
  const details = fetchDetails(trace.event);
  const failed =
    trace.exceptions.length > 0 ||
    trace.outcome !== "ok" ||
    (details.status !== null && details.status >= 500);
  if (!failed) return null;
  return {
    script: trace.scriptName?.slice(0, 80) || "unknown-worker",
    kind: details.kind,
    outcome: trace.outcome.slice(0, 40),
    status: details.status,
    exceptionCount: trace.exceptions.length,
    truncated: trace.truncated,
  };
}

function alertText(incident: SafeIncident): string {
  return `:warning: *Worker 오류 감지*\n서비스: ${incident.script}\n실행: ${incident.kind} · ${incident.outcome}${incident.status === null ? "" : ` · HTTP ${incident.status}`}\n예외: ${incident.exceptionCount}개${incident.truncated ? " · 로그 일부 잘림" : ""}\n원본 요청·헤더·본문·로그·stack trace는 Slack에 전송하지 않았습니다.`;
}

export async function handleLogAlerts(
  traces: readonly TraceItem[],
  env: LogAlertEnv,
): Promise<number> {
  let sent = 0;
  for (const incident of traces
    .flatMap((trace) => {
      const parsed = safeLogIncident(trace);
      return parsed ? [parsed] : [];
    })
    .slice(0, 5)) {
    const key = `${incident.script}:${incident.kind}:${incident.outcome}:${incident.status ?? 0}`;
    if (!(await env.ALERT_RATE_LIMITER.limit({ key })).success) continue;
    await callSlack(env.SLACK_BOT_TOKEN, "chat.postMessage", {
      channel: env.COMMUNITY_SYS_ALERT_CHANNEL_ID,
      text: alertText(incident),
      unfurl_links: false,
      unfurl_media: false,
    });
    sent += 1;
  }
  return sent;
}

export default {
  async tail(traces: TraceItem[], env: LogAlertEnv): Promise<void> {
    try {
      await handleLogAlerts(traces, env);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "log_alert.delivery_failed",
          errorType: error instanceof Error ? error.name : "Unknown",
        }),
      );
      throw error;
    }
  },
} satisfies ExportedHandler<LogAlertEnv>;
