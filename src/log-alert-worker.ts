import { escapeSlackText } from "./community-messages";
import { callSlack } from "./community-social";
import type { Json } from "./input";

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
  readonly route: string;
  readonly outcome: string;
  readonly status: number | null;
  readonly exceptionCount: number;
  readonly exceptionType: string | null;
  readonly eventCode: string | null;
  readonly errorType: string | null;
  readonly occurredAt: number | null;
  readonly truncated: boolean;
};

function fetchDetails(event: TraceItem["event"]): {
  readonly kind: string;
  readonly route: string;
  readonly status: number | null;
} {
  if (event && "request" in event) {
    let route = "기타 HTTP";
    try {
      const pathname = new URL(event.request.url).pathname;
      if (pathname === "/slack/events") route = "Slack 이벤트";
      else if (pathname === "/slack/interactions") route = "Slack 버튼·모달";
      else if (pathname === "/health") route = "상태 확인";
      else if (pathname.startsWith("/events/")) route = "이벤트 API";
      else if (pathname.startsWith("/board/")) route = "잔디 이미지";
      else if (pathname === "/" || pathname.startsWith("/join")) route = "홈페이지";
    } catch {
      route = "잘못된 HTTP 주소";
    }
    return { kind: "HTTP", route, status: event.response?.status ?? null };
  }
  if (event && "cron" in event) return { kind: "Cron", route: "정기 작업", status: null };
  if (event && "queue" in event) return { kind: "Queue", route: "비동기 작업", status: null };
  if (event && "scheduledTime" in event) return { kind: "Alarm", route: "예약 작업", status: null };
  if (event && "rpcMethod" in event)
    return { kind: "RPC", route: "Worker 내부 호출", status: null };
  return { kind: "기타", route: "알 수 없음", status: null };
}

function safeCode(value: unknown, pattern: RegExp, limit: number): string | null {
  return typeof value === "string" && value.length <= limit && pattern.test(value) ? value : null;
}

function structuredError(logs: readonly TraceLog[]): {
  readonly eventCode: string | null;
  readonly errorType: string | null;
} {
  for (const log of logs) {
    if (!["error", "warn"].includes(log.level)) continue;
    const values = Array.isArray(log.message) ? log.message : [log.message];
    for (const value of values) {
      let parsed: unknown = value;
      if (typeof value === "string" && value.length <= 2_000)
        try {
          parsed = JSON.parse(value);
        } catch {
          continue;
        }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
      const record = parsed as Record<string, unknown>;
      const eventCode = safeCode(record.event, /^[a-z0-9_.-]+$/, 100);
      const errorType = safeCode(record.errorType ?? record.type, /^[A-Za-z][A-Za-z0-9_.-]*$/, 80);
      if (eventCode || errorType) return { eventCode, errorType };
    }
  }
  return { eventCode: null, errorType: null };
}

function criticalProductError(logs: readonly TraceLog[]): {
  readonly eventCode: string;
  readonly errorType: string | null;
} | null {
  for (const log of logs) {
    if (!["error", "warn"].includes(log.level)) continue;
    const values = Array.isArray(log.message) ? log.message : [log.message];
    for (const value of values) {
      let parsed: unknown = value;
      if (typeof value === "string" && value.length <= 2_000)
        try {
          parsed = JSON.parse(value);
        } catch {
          continue;
        }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
      const record = parsed as Record<string, unknown>;
      const eventCode = safeCode(record.event, /^[a-z0-9_.-]+$/, 100);
      if (
        eventCode !== "community.scrum.schedule.failed" &&
        eventCode !== "community.scrum.slo_missed"
      )
        continue;
      return {
        eventCode,
        errorType: safeCode(record.errorType ?? record.type, /^[A-Za-z][A-Za-z0-9_.-]*$/, 80),
      };
    }
  }
  return null;
}

export function safeLogIncident(trace: TraceItem): SafeIncident | null {
  const details = fetchDetails(trace.event);
  const critical = criticalProductError(trace.logs);
  const structured = critical ?? structuredError(trace.logs);
  const productCritical = critical !== null;
  const failed =
    trace.exceptions.length > 0 ||
    trace.outcome !== "ok" ||
    (details.status !== null && details.status >= 500) ||
    productCritical;
  if (!failed) return null;
  return {
    script: safeCode(trace.scriptName, /^[A-Za-z0-9_.-]+$/, 80) ?? "unknown-worker",
    kind: details.kind,
    route: details.route,
    outcome: trace.outcome.slice(0, 40),
    status: details.status,
    exceptionCount: trace.exceptions.length,
    exceptionType:
      trace.exceptions
        .map((exception) => safeCode(exception.name, /^[A-Za-z][A-Za-z0-9_.-]*$/, 80))
        .find((value) => value !== null) ?? null,
    eventCode: structured.eventCode,
    errorType: structured.errorType,
    occurredAt: trace.eventTimestamp,
    truncated: trace.truncated,
  };
}

function incidentTime(incident: SafeIncident): string {
  if (incident.occurredAt === null || !Number.isFinite(incident.occurredAt)) return "시각 미확인";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(incident.occurredAt));
}

function alertMessage(incident: SafeIncident): { readonly text: string; readonly blocks: Json[] } {
  const severity =
    incident.outcome !== "ok"
      ? "런타임 실패"
      : incident.status && incident.status >= 500
        ? "HTTP 5xx"
        : "처리 예외";
  const error =
    [incident.eventCode, incident.errorType, incident.exceptionType]
      .filter(
        (value, index, values): value is string =>
          Boolean(value) && values.indexOf(value) === index,
      )
      .join(" · ") || "분류되지 않은 예외";
  const status = `${incident.kind} · ${incident.outcome}${incident.status === null ? "" : ` · HTTP ${incident.status}`}`;
  const text = `Worker 오류 · ${incident.script} · ${incident.route} · ${error}`;
  return {
    text,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `🔴 ${severity}` },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*서비스*\n${escapeSlackText(incident.script)}` },
          { type: "mrkdwn", text: `*발생 위치*\n${escapeSlackText(incident.route)}` },
          { type: "mrkdwn", text: `*실행 상태*\n${escapeSlackText(status)}` },
          { type: "mrkdwn", text: `*오류 종류*\n${escapeSlackText(error)}` },
        ],
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `${incidentTime(incident)} KST · 예외 ${incident.exceptionCount}개${incident.truncated ? " · Cloudflare 로그 일부 잘림" : ""}`,
          },
        ],
      },
      {
        type: "context",
        elements: [
          {
            type: "plain_text",
            text: "요청 본문·헤더·쿠키·원본 로그·stack trace는 Slack에 전송하지 않았습니다.",
          },
        ],
      },
    ],
  };
}

export async function handleLogAlerts(
  traces: readonly TraceItem[],
  env: LogAlertEnv,
): Promise<number> {
  let sent = 0;
  const fingerprints = new Set<string>();
  for (const incident of traces
    .flatMap((trace) => {
      const parsed = safeLogIncident(trace);
      return parsed ? [parsed] : [];
    })
    .slice(0, 5)) {
    const key = `${incident.script}:${incident.kind}:${incident.route}:${incident.outcome}:${incident.status ?? 0}:${incident.eventCode ?? ""}:${incident.errorType ?? incident.exceptionType ?? ""}`;
    if (fingerprints.has(key)) continue;
    fingerprints.add(key);
    if (!(await env.ALERT_RATE_LIMITER.limit({ key })).success) continue;
    const message = alertMessage(incident);
    await callSlack(env.SLACK_BOT_TOKEN, "chat.postMessage", {
      channel: env.COMMUNITY_SYS_ALERT_CHANNEL_ID,
      ...message,
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
