import type { ClockStorage } from "./community-clock-bug";

type Cycle = { id: string; attempt: number; startedAt: number; completedAt?: number };
type Role = "bug_delivery" | "community_schedule";
function emit(cycle: Cycle, role: Role, phase: "start" | "complete" | "retry") {
  console.log(
    JSON.stringify({
      event: "community.alarm.observation",
      role,
      phase,
      cycleId: cycle.id,
      attempt: cycle.attempt,
      startedAt: cycle.startedAt,
      ...(cycle.completedAt === undefined ? {} : { completedAt: cycle.completedAt }),
    }),
  );
}
export async function beginAlarmObservation(
  storage: ClockStorage,
  role: Role,
  now: number,
): Promise<Cycle> {
  const previous = await storage.get<Cycle>("alarmObservation");
  // Replay a durable completion receipt. A canceled invocation may have already
  // committed its work before its trace was delivered.
  if (previous?.completedAt !== undefined) emit(previous, role, "complete");
  const cycle: Cycle =
    previous && previous.completedAt === undefined
      ? { ...previous, attempt: previous.attempt + 1 }
      : { id: crypto.randomUUID(), attempt: 1, startedAt: now };
  await storage.put("alarmObservation", cycle);
  emit(cycle, role, "start");
  return cycle;
}
export async function finishAlarmObservation(
  storage: ClockStorage,
  cycle: Cycle,
  role: Role,
  complete: boolean,
) {
  const next = complete ? { ...cycle, completedAt: Date.now() } : cycle;
  await storage.put("alarmObservation", next);
  emit(next, role, complete ? "complete" : "retry");
}
