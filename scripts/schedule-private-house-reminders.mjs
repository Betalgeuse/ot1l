import { resolve } from "node:path";

const CHANNEL_ID = "C0C0621V0QZ";
const ROOT_TS = "1790698679.068339";
const REMINDER_DATES = ["2026-10-07", "2026-10-14", "2026-10-21", "2026-10-28"];
const REMINDER_HOUR_KST = 12;

const postAt = (date) =>
  Math.floor(Date.parse(`${date}T${String(REMINDER_HOUR_KST).padStart(2, "0")}:00:00+09:00`) / 1000);

async function slack(token, method, body = {}) {
  const readOnly =
    method.startsWith("chat.scheduledMessages.list") || method.startsWith("chat.getPermalink");
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: readOnly ? "GET" : "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(readOnly ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json();
  if (!value.ok) throw new Error(`${method} failed: ${value.error ?? "unknown"}`);
  return value;
}

async function getPermalink(token) {
  const query = new URLSearchParams({ channel: CHANNEL_ID, message_ts: ROOT_TS });
  return slack(token, `chat.getPermalink?${query}`).then((value) => value.permalink);
}

async function scheduledMessages(token) {
  const result = [];
  let cursor = "";
  do {
    const query = new URLSearchParams({ channel: CHANNEL_ID, limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const page = await slack(token, `chat.scheduledMessages.list?${query}`);
    result.push(...(page.scheduled_messages ?? []));
    cursor = page.response_metadata?.next_cursor ?? "";
  } while (cursor);
  return result;
}

export function reminderText(permalink) {
  return `<!channel> *OT1L에서 같이 뭐 하고 놀까요?*\n피클볼·포커·보드게임·러닝·전시·맛있는 저녁, 또는 새로운 아이디어도 좋아요. 공지에서 :raising_hand: 반응이나 한 줄 의견을 남겨주세요. 의견은 10월 31일까지 받을게요.\n<${permalink}|같이 해보고 싶은 활동 보기>`;
}

export function reminderPlan(permalink, now = Date.now()) {
  const text = reminderText(permalink);
  return REMINDER_DATES.map((date) => ({ date, postAt: postAt(date), text })).filter(
    (item) => item.postAt * 1000 > now + 10 * 60 * 1000,
  );
}

const canonicalSlackText = (value) => value.replaceAll("&amp;", "&");

async function main() {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN is required");
  const apply = process.argv.includes("--apply");
  const permalink = await getPermalink(token);
  const plan = reminderPlan(permalink);
  const existing = await scheduledMessages(token);
  const missing = plan.filter(
    (item) =>
      !existing.some(
        (message) =>
          Number(message.post_at) === item.postAt &&
          canonicalSlackText(message.text) === canonicalSlackText(item.text),
      ),
  );
  if (apply)
    for (const item of missing)
      await slack(token, "chat.scheduleMessage", {
        channel: CHANNEL_ID,
        post_at: item.postAt,
        text: item.text,
        unfurl_links: false,
      });
  const verified = await scheduledMessages(token);
  const scheduled = plan.filter((item) =>
    verified.some(
      (message) =>
        Number(message.post_at) === item.postAt &&
        canonicalSlackText(message.text) === canonicalSlackText(item.text),
    ),
  );
  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "plan",
      plannedDates: plan.map((item) => item.date),
      created: apply ? missing.length : 0,
      verifiedDates: scheduled.map((item) => item.date),
    }),
  );
  if (apply && scheduled.length !== plan.length) throw new Error("scheduled reminder verification failed");
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "schedule failed");
    process.exitCode = 1;
  });
