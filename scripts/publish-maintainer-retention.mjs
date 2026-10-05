import { publishMaintainerRetentionGuide } from "../src/community-maintainer-retention.ts";

if (!process.argv.includes("--apply")) throw new Error("Use --apply to publish the Maintainer retention guide");
for (const name of ["SLACK_BOT_TOKEN", "COMMUNITY_RETENTION_CHANNEL_ID"])
  if (!process.env[name]) throw new Error(`Missing ${name}`);
const ts = await publishMaintainerRetentionGuide({
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
  COMMUNITY_RETENTION_CHANNEL_ID: process.env.COMMUNITY_RETENTION_CHANNEL_ID,
  COMMUNITY_MAINTAINERS_CHANNEL_ID: process.env.COMMUNITY_MAINTAINERS_CHANNEL_ID,
});
console.log(JSON.stringify({ published: true, messageTs: ts }));
