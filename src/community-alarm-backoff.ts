export function dbAlarmRetryDelayMinutes(consecutiveFailures: number): number {
  return [1, 2, 4, 8, 15, 30][Math.min(Math.max(0, consecutiveFailures), 5)] ?? 30;
}
