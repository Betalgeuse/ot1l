export const WAKE_WINDOW_MINUTES = 4;
export const WAKE_WINDOW_CRON = "1,31 * * * *";
export const WAKE_WINDOW_START_MINUTES = Object.freeze([1, 31]);

export function inWakeWindow(date) {
  const minute = date.getUTCMinutes();
  return WAKE_WINDOW_START_MINUTES.some(
    (start) => minute >= start && minute < start + WAKE_WINDOW_MINUTES,
  );
}

export function msUntilNextWakeWindow(date) {
  if (inWakeWindow(date)) return 0;
  const next = new Date(date);
  next.setUTCHours(next.getUTCHours(), 0, 0, 0);
  const startThisHour = WAKE_WINDOW_START_MINUTES.find((minute) => minute > date.getUTCMinutes());
  if (startThisHour !== undefined) {
    next.setUTCMinutes(startThisHour);
  } else {
    next.setUTCHours(next.getUTCHours() + 1);
    next.setUTCMinutes(WAKE_WINDOW_START_MINUTES[0]);
  }
  return next.getTime() - date.getTime();
}
