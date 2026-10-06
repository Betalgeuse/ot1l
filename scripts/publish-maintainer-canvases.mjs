import {
  MAINTAINER_CANVAS_VERSION,
  maintainerCanvasDefinitions,
  publishMaintainerCanvases,
} from "../src/community-maintainer-canvases.ts";

const env = {
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
  COMMUNITY_MAINTAINERS_CHANNEL_ID: process.env.COMMUNITY_MAINTAINERS_CHANNEL_ID,
  COMMUNITY_MAINTAINER_WORKSTREAM_CHANNEL_IDS:
    process.env.COMMUNITY_MAINTAINER_WORKSTREAM_CHANNEL_IDS,
  COMMUNITY_FEEDBACK_CHANNEL_ID: process.env.COMMUNITY_FEEDBACK_CHANNEL_ID,
  COMMUNITY_RELEASE_CHANNEL_ID: process.env.COMMUNITY_RELEASE_CHANNEL_ID,
  COMMUNITY_SYS_ALERT_CHANNEL_ID: process.env.COMMUNITY_SYS_ALERT_CHANNEL_ID,
};

const definitions = maintainerCanvasDefinitions(env);
if (!process.argv.includes("--apply")) {
  console.log(
    JSON.stringify({
      dryRun: true,
      version: MAINTAINER_CANVAS_VERSION,
      channels: definitions.map(({ key, channelId, title, topic, purpose }) => ({
        key,
        channelId,
        title,
        topic,
        purpose,
      })),
    }),
  );
  process.exit(0);
}
if (!env.SLACK_BOT_TOKEN) throw new Error("Missing SLACK_BOT_TOKEN");
const receipts = await publishMaintainerCanvases(env);
console.log(JSON.stringify({ published: true, version: MAINTAINER_CANVAS_VERSION, receipts }));
