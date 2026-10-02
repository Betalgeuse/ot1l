import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { townhallEventLauncher } from "../src/community-townhall-events.ts";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const local = {};
for (const line of readFileSync(resolve(root, ".dev.vars"), "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const separator = line.indexOf("=");
  if (separator > 0) local[line.slice(0, separator)] = line.slice(separator + 1);
}
const token = process.env.SLACK_BOT_TOKEN ?? local.SLACK_BOT_TOKEN;
const production = JSON.parse(readFileSync(resolve(root, ".wrangler.production.json"), "utf8"));
const channel = production.vars?.COMMUNITY_RELEASE_CHANNEL_ID;
if (!token || !/^[CG][A-Z0-9]+$/.test(channel ?? ""))
  throw new Error("Townhall launcher configuration is missing");

async function slack(method, body) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || data.ok !== true) throw new Error(`Slack ${method} failed: ${data.error ?? response.status}`);
  return data;
}

const launcher = townhallEventLauncher();
const history = await slack("conversations.history", { channel, limit: 100 });
const existing = history.messages?.find(
  (message) =>
    message.text?.startsWith("누구나 작은 활동을 열 수 있어요.") &&
    message.blocks?.some((block) =>
      block.elements?.some((element) => element.action_id === "community_event_open"),
    ) &&
    !message.blocks?.some((block) =>
      block.elements?.some((element) =>
        ["community_event_availability", "community_event_edit"].includes(element.action_id),
      ),
    ),
);
const message = existing
  ? existing.text === launcher.text
    ? existing
    : await slack("chat.update", { channel, ts: existing.ts, ...launcher })
  : await slack("chat.postMessage", { channel, ...launcher });
try {
  await slack("pins.add", { channel, timestamp: message.ts });
} catch (error) {
  if (!String(error).includes("already_pinned")) throw error;
}
console.log(JSON.stringify({
  status: existing ? (existing.text === launcher.text ? "already_present" : "updated") : "created",
  channel,
  ts: message.ts,
}));
