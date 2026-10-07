import { MaintainerOpsStore } from "../src/community-maintainer-store.ts";
import {
  ensureProductOwnerGroups,
  syncProductOwnerBaseGroup,
} from "../src/community-product-owner-groups.ts";

if (!process.argv.includes("--apply"))
  throw new Error("Use --apply to create or update Product Owner user groups");

const required = [
  "SLACK_BOT_TOKEN",
  "SLACK_TEAM_ID",
  "DATABASE_URL",
  "COMMUNITY_ADMIN_ID",
  "COMMUNITY_MAINTAINERS_CHANNEL_ID",
  "COMMUNITY_MAINTAINER_WORKSTREAM_CHANNEL_IDS",
  "COMMUNITY_RETENTION_CHANNEL_ID",
];
for (const name of required) if (!process.env[name]) throw new Error(name + " is required");

const [dev, design, discussion] =
  process.env.COMMUNITY_MAINTAINER_WORKSTREAM_CHANNEL_IDS.split(",").map((value) =>
    value.trim(),
  );
if (
  !dev ||
  !design ||
  !discussion ||
  discussion !== process.env.COMMUNITY_RETENTION_CHANNEL_ID
)
  throw new Error("PO workstream channel configuration is invalid");

const groups = await ensureProductOwnerGroups(process.env.SLACK_BOT_TOKEN, {
  po: [process.env.COMMUNITY_RETENTION_CHANNEL_ID, process.env.COMMUNITY_MAINTAINERS_CHANNEL_ID],
  designer: [design],
  dev: [dev],
});

const store = new MaintainerOpsStore({
  DATABASE_URL: process.env.DATABASE_URL,
  SLACK_TEAM_ID: process.env.SLACK_TEAM_ID,
  COMMUNITY_ADMIN_ID: process.env.COMMUNITY_ADMIN_ID,
});
const members = await store.execute("members", {});
if (!Array.isArray(members)) throw new Error("Product Owner member list is unavailable");
for (const member of members) {
  if (
    typeof member !== "object" ||
    member === null ||
    Array.isArray(member) ||
    typeof member.userId !== "string"
  )
    throw new Error("Product Owner member record is invalid");
  await syncProductOwnerBaseGroup(process.env.SLACK_BOT_TOKEN, member.userId, true);
}

console.log(
  JSON.stringify({
    applied: true,
    groups: groups.map((group) => ({ handle: group.handle, id: group.id })),
    activeProductOwners: members.length,
  }),
);
