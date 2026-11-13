import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const generated = await run(
  process.execPath,
  ["scripts/slack-manifest.mjs", "https://example.invalid"],
  { encoding: "utf8" },
);
const manifest = JSON.parse(generated.stdout);
const scopes = manifest.oauth_config.scopes.bot;
assert.equal(new Set(scopes).size, scopes.length);
assert.ok(scopes.includes("users:read"));
assert.ok(scopes.includes("users:read.email"));
assert.ok(scopes.includes("im:write"));
assert.ok(scopes.includes("channels:write.invites"));
assert.ok(scopes.includes("channels:manage"));
assert.equal(scopes.includes("groups:write"), false);
assert.ok(scopes.includes("reactions:read"));
for (const scope of [
  "canvases:read",
  "canvases:write",
  "pins:read",
  "pins:write",
  "bookmarks:read",
  "bookmarks:write",
])
  assert.ok(scopes.includes(scope));
assert.equal(scopes.includes("message.im"), false);
assert.ok(manifest.settings.event_subscriptions.bot_events.includes("team_join"));
assert.ok(manifest.settings.event_subscriptions.bot_events.includes("reaction_added"));
assert.ok(manifest.settings.event_subscriptions.bot_events.includes("reaction_removed"));

console.log(
  "PASS Slack manifest scopes are unique and include the required set",
);
