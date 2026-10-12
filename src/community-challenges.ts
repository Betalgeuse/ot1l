import {
  type ChallengeTrack,
  sourceChallenge,
  sourcedChallengePayload,
} from "./community-challenge-sources";
import type { CommunityEnv } from "./community-runtime";
import { callSlack } from "./community-social";
import type { CommunityStore } from "./community-store";
import { type Json, list, object, string } from "./input";

export const CHALLENGE_CONFIG_KEY = "chapter-daily-challenges:v1";
type Store = Pick<CommunityStore, "getRecord" | "putRecord" | "claimRecord" | "finishRecord">;
type Env = Pick<
  CommunityEnv,
  "SLACK_TEAM_ID" | "SLACK_BOT_TOKEN" | "COMMUNITY_ADMIN_ID" | "COMMUNITY_PUBLIC_CHANNEL_ID"
>;
type Target = { track: ChallengeTrack; channelId: string };
type Config = { enabled: boolean; startDate: string; targets: Target[] };

export function challengeConfig(value: Json): Config {
  const v = object(value);
  if (typeof v.enabled !== "boolean") throw new Error("Invalid challenge enabled flag");
  const startDate = string(v.startDate);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    new Date(`${startDate}T00:00:00Z`).toISOString().slice(0, 10) !== startDate
  )
    throw new Error("Invalid challenge start date");
  const targets = list(v.targets).map((entry): Target => {
    const t = object(entry);
    if (t.track !== "dev" && t.track !== "math") throw new Error("Invalid challenge track");
    const channelId = string(t.channelId);
    if (!/^C[A-Z0-9]+$/.test(channelId)) throw new Error("Invalid challenge channel");
    return { track: t.track, channelId };
  });
  if (
    targets.length !== 2 ||
    new Set(targets.map((t) => t.track)).size !== 2 ||
    new Set(targets.map((t) => t.channelId)).size !== 2
  )
    throw new Error("Two distinct challenge channels required");
  return { enabled: v.enabled, startDate, targets };
}

const marker = (track: ChallengeTrack, date: string, phase: string) =>
  `otl1_challenge_${track}_${date}_${phase}`;

async function findMessage(
  env: Env,
  channel: string,
  day: string,
  id: string,
  root?: string,
): Promise<string | null> {
  let cursor = "";
  for (let page = 0; page < 10; page++) {
    const result = await callSlack(
      env.SLACK_BOT_TOKEN,
      root ? "conversations.replies" : "conversations.history",
      {
        channel,
        limit: 100,
        ...(root ? { ts: root } : { oldest: String(Date.parse(`${day}T00:00:00+09:00`) / 1000) }),
        ...(cursor ? { cursor } : {}),
      },
    );
    for (const raw of list(result.messages)) {
      const m = object(raw);
      if (!m.bot_id || (root ? m.thread_ts !== root : m.thread_ts && m.thread_ts !== m.ts))
        continue;
      if (Array.isArray(m.blocks) && m.blocks.some((b) => object(b).block_id === id))
        return string(m.ts);
    }
    cursor =
      typeof object(result.response_metadata ?? {}).next_cursor === "string"
        ? String(object(result.response_metadata ?? {}).next_cursor)
        : "";
    if (!cursor && result.has_more !== true) return null;
    if (!cursor) throw new Error("Incomplete challenge history");
  }
  throw new Error("Challenge history pagination limit");
}

export async function runDailyChallenges(
  env: Env,
  store: Store,
  now: Date,
  onlyTrack?: ChallengeTrack,
): Promise<number> {
  if (!env.COMMUNITY_ADMIN_ID || !env.COMMUNITY_PUBLIC_CHANNEL_ID) return 0;
  const control = {
    teamId: env.SLACK_TEAM_ID,
    channelId: env.COMMUNITY_PUBLIC_CHANNEL_ID,
    userId: env.COMMUNITY_ADMIN_ID,
  };
  const settings = await store.getRecord({ ...control, key: CHALLENGE_CONFIG_KEY });
  if (!settings) return 0;
  const config = challengeConfig(settings.body);
  const local = new Date(now.getTime() + 9 * 3600_000).toISOString();
  const day = local.slice(0, 10),
    minute = local.slice(11, 16);
  if (!config.enabled || day < config.startDate || minute < "09:00" || minute >= "22:00") return 0;
  const index = Math.round((Date.parse(day) - Date.parse(config.startDate)) / 86400_000);
  let delivered = 0;
  for (const target of config.targets) {
    if (onlyTrack && target.track !== onlyTrack) continue;
    try {
      const scope = { ...control, channelId: target.channelId };
      const contentKey = { ...scope, key: `challenge-source-content:${day}` };
      let snapshot = await store.getRecord(contentKey);
      if (!snapshot) {
        const selection = {
          ...scope,
          key: `challenge-select:${day}:${Math.floor(now.getTime() / 300_000)}`,
        };
        await store.putRecord({ ...selection, kind: "chapter_challenge_selection", body: { day } });
        if (!(await store.claimRecord(selection))) continue;
        try {
          const source = await sourceChallenge(target.track, index, day, async (candidate) => {
            const assigned = await store.putRecord({
              ...scope,
              key: `challenge-source:${candidate.id}`,
              kind: "chapter_challenge_source",
              body: { day, sourceUrl: candidate.url },
            });
            return object(assigned.body).day === day;
          });
          snapshot = await store.putRecord({
            ...contentKey,
            kind: "chapter_challenge_content",
            body: sourcedChallengePayload(target.track, day, source),
          });
          await store.finishRecord(selection, "sent");
        } catch (error) {
          await store.finishRecord(selection, "failed");
          throw error;
        }
      }
      const content = object(snapshot.body);
      let root: string | null = null;
      for (const phase of minute >= "18:00" ? ["problem", "solution"] : ["problem"]) {
        const key = `chapter-challenge:${day}:${phase}`;
        const receipt = await store.getRecord({ ...scope, key });
        if (receipt) {
          if (phase === "problem") root = string(object(receipt.body).messageTs);
          continue;
        }
        // A bounded attempt per five-minute slot. Failed/crashed slots do not
        // permanently suppress later attempts; every new attempt reconciles Slack.
        const attempt = { ...scope, key: `${key}:attempt:${Math.floor(now.getTime() / 300_000)}` };
        await store.putRecord({
          ...attempt,
          kind: "chapter_challenge_attempt",
          body: { day, phase },
        });
        if (!(await store.claimRecord(attempt))) break;
        try {
          const info = object(
            (
              await callSlack(env.SLACK_BOT_TOKEN, "conversations.info", {
                channel: target.channelId,
              })
            ).channel,
          );
          if (
            info.name !== `chapter-${target.track}` ||
            info.is_archived === true ||
            info.is_private === true
          )
            throw new Error("Challenge channel mismatch");
          const problemId = marker(target.track, day, "problem");
          // Never let Slack turn a reply to a deleted parent into a new root.
          if (phase === "solution") {
            const parent = await findMessage(env, target.channelId, day, problemId);
            if (!parent || (root && parent !== root)) throw new Error("Challenge parent missing");
            root = parent;
          }
          const id = marker(target.track, day, phase);
          let ts = await findMessage(
            env,
            target.channelId,
            day,
            id,
            phase === "solution" ? (root ?? undefined) : undefined,
          );
          if (!ts) {
            const text = string(content[phase === "problem" ? "text" : "solution"]);
            const posted = await callSlack(env.SLACK_BOT_TOKEN, "chat.postMessage", {
              channel: target.channelId,
              text,
              unfurl_links: false,
              unfurl_media: false,
              ...(phase === "solution" ? { thread_ts: root, reply_broadcast: false } : {}),
              blocks: [{ type: "section", block_id: id, text: { type: "mrkdwn", text } }],
            });
            ts = string(posted.ts);
            if (phase === "solution" && object(posted.message).thread_ts !== root) {
              // Parent can disappear between the read and Slack accepting a reply.
              // Reclaim only the exact message created by this call.
              await callSlack(env.SLACK_BOT_TOKEN, "chat.delete", {
                channel: target.channelId,
                ts,
              });
              throw new Error("Challenge reply not threaded");
            }
          }
          await store.putRecord({
            ...scope,
            key,
            kind: "chapter_challenge_receipt",
            body: { messageTs: ts, day, phase },
          });
          if (phase === "problem") root = ts;
          await store.finishRecord(attempt, "sent");
          delivered++;
        } catch (error) {
          await store.finishRecord(attempt, "failed");
          throw error;
        }
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "community.chapter.challenge_failed",
          channel: target.channelId,
          day,
          errorType: error instanceof Error ? error.name : "Unknown",
          reason:
            error instanceof Error && /^(atcoder|mensa|challenge)_[a-z_]+$/.test(error.message)
              ? error.message
              : "delivery_failed",
        }),
      );
    }
  }
  return delivered;
}
