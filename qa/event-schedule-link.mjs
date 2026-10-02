import assert from "node:assert/strict";
import { eventScheduleToken, readEventScheduleToken } from "../src/community-event-link.ts";

const originalNow = Date.now;
try {
  Date.now = () => Date.parse("2026-10-02T00:00:00Z");
  const identity = { teamId: "TQA", channelId: "CTOWN", eventId: "VEVENT-1", userId: "UMEMBER" };
  const token = await eventScheduleToken(identity, "event-secret");
  assert.deepEqual(await readEventScheduleToken(token, "event-secret"), identity);
  await assert.rejects(readEventScheduleToken(`${token.slice(0, -1)}0`, "event-secret"));
  Date.now = () => Date.parse("2026-10-10T00:00:00Z");
  await assert.rejects(readEventScheduleToken(token, "event-secret"), /만료/);
  console.log("PASS event schedule links bind Slack actor, event, expiry, and signature");
} finally {
  Date.now = originalNow;
}
