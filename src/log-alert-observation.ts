export type AlarmSignal = {
  readonly key: string;
  readonly cycleId: string;
  readonly role: "bug_delivery" | "community_schedule";
  readonly phase: "canceled" | "complete";
  readonly at: number;
  readonly version: string | null;
};
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export function validAlarmSignal(input: AlarmSignal): boolean {
  return (
    /^[a-f0-9]{64}$/.test(input.key) &&
    UUID.test(input.cycleId) &&
    ["bug_delivery", "community_schedule"].includes(input.role) &&
    ["canceled", "complete"].includes(input.phase) &&
    Number.isSafeInteger(input.at) &&
    input.at <= 8_640_000_000_000_000 &&
    input.at > 0 &&
    (input.version === null || UUID.test(input.version))
  );
}
export async function alarmSignals(trace: TraceItem): Promise<AlarmSignal[]> {
  if (
    trace.scriptName !== "otl1-onething-garden" ||
    !trace.event ||
    !("scheduledTime" in trace.event) ||
    "cron" in trace.event ||
    trace.truncated ||
    !/^[a-f0-9]{64}$/.test(trace.durableObjectId ?? "")
  )
    return [];
  const records: Record<string, unknown>[] = [];
  for (const log of trace.logs)
    for (const raw of Array.isArray(log.message) ? log.message : [log.message]) {
      if (typeof raw !== "string" || raw.length > 1000) continue;
      try {
        const row = JSON.parse(raw);
        if (
          row?.event === "community.alarm.observation" &&
          UUID.test(row.cycleId ?? "") &&
          ["bug_delivery", "community_schedule"].includes(row.role)
        )
          records.push(row);
      } catch {
        /* Raw log contents never leave the runtime. */
      }
    }
  const clean = trace.exceptions.length === 0 && !trace.logs.some((log) => log.level === "error");
  const chosen =
    trace.outcome === "ok" && clean
      ? records.filter((r) => r.phase === "complete")
      : trace.outcome === "canceled" && clean
        ? records.filter((r) => r.phase === "start").slice(-1)
        : [];
  const result: AlarmSignal[] = [];
  for (const row of chosen.slice(-3)) {
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${trace.scriptName}:${trace.durableObjectId}:${row.cycleId}`),
    );
    const signal: AlarmSignal = {
      key: Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join(""),
      cycleId: String(row.cycleId),
      role: row.role as AlarmSignal["role"],
      phase: trace.outcome === "ok" ? "complete" : "canceled",
      at: trace.outcome === "ok" ? Number(row.completedAt) : Number(trace.eventTimestamp),
      version: UUID.test(trace.scriptVersion?.id ?? "") ? (trace.scriptVersion?.id ?? null) : null,
    };
    if (validAlarmSignal(signal)) result.push(signal);
  }
  return result;
}
