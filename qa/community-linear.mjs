import assert from "node:assert/strict";
import {
  assignLinearIssue,
  createLinearIssue,
  inviteLinearGuest,
  LinearApiError,
  linearTeamMembers,
} from "../src/community-linear-client.ts";

const teamId = "b2e0bc66-7bea-466c-b65e-2495e8d3edb9";
const organizationId = "8c031438-a94b-4edd-838e-98d4bd616ed1";
const issueId = "11111111-1111-4111-8111-111111111111";
const assigneeId = "22222222-2222-4222-8222-222222222222";
const env = {
  LINEAR_API_KEY: "lin_api_issue",
  LINEAR_ADMIN_API_KEY: "lin_api_admin",
  LINEAR_TEAM_ID: teamId,
  LINEAR_ORGANIZATION_ID: organizationId,
};
const calls = [];
let issue = null;
const original = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (url === "https://api.linear.app/oauth/token") {
    assert.match(options.headers.Authorization, /^Basic /);
    assert.match(String(options.body), /grant_type=client_credentials/);
    return Response.json({ access_token: "x".repeat(40), token_type: "Bearer", expires_in: 2591999 });
  }
  assert.equal(url, "https://api.linear.app/graphql");
  const body = JSON.parse(options.body);
  calls.push({ authorization: options.headers.Authorization, ...body });
  if (body.query.includes("organizationInvite(id:"))
    return Response.json({ errors: [{ message: "Entity not found: OrganizationInvite", extensions: { code: "INPUT_ERROR" } }], data: null }, { status: 400 });
  if (body.query.includes("organizationInviteCreate"))
    return Response.json({ data: { organizationInviteCreate: { success: true, organizationInvite: { id: body.variables.input.id, role: "guest" } } } });
  if (body.query.includes("team(id:"))
    return Response.json({ data: { team: { id: teamId, key: "OT1", organization: { id: organizationId }, members: { nodes: [{ id: assigneeId, name: "Operator", email: "operator@example.com", guest: true, active: true, teamMemberships: { nodes: [{ id: "membership-1", team: { id: teamId } }] } }], pageInfo: { hasNextPage: false, endCursor: null } } } } });
  if (body.query.includes("issueCreate")) {
    issue = { id: issueId, identifier: "OT1-1", title: body.variables.input.title, description: body.variables.input.description, url: "https://linear.app/betalgeuse/issue/OT1-1/test", updatedAt: "2026-10-05T08:00:00.000Z", team: { id: teamId, key: "OT1" }, assignee: null, creator: { id: "creator" }, state: { id: "state", name: "Backlog", type: "backlog" } };
    return Response.json({ data: { issueCreate: { success: true, issue } } });
  }
  if (body.query.includes("issueUpdate")) {
    issue = { ...issue, assignee: { id: body.variables.input.assigneeId }, updatedAt: "2026-10-05T08:01:00.000Z" };
    return Response.json({ data: { issueUpdate: { success: true } } });
  }
  if (body.query.includes("issue(id:")) {
    if (!issue) return Response.json({ errors: [{ message: "Entity not found: Issue", extensions: { code: "INPUT_ERROR" } }], data: null }, { status: 400 });
    return Response.json({ data: { issue } });
  }
  throw new Error(`unexpected query ${body.query}`);
};
try {
  const members = await linearTeamMembers(env);
  assert.equal(members[0].id, assigneeId);
  const appMembers = await linearTeamMembers({
    ...env,
    LINEAR_API_KEY: undefined,
    LINEAR_APP_CLIENT_ID: "a".repeat(32),
    LINEAR_APP_CLIENT_SECRET: "app-secret-value",
  });
  assert.equal(appMembers[0].id, assigneeId);
  assert.equal(calls.find((call) => call.authorization === `Bearer ${"x".repeat(40)}`) !== undefined, true);
  const created = await createLinearIssue(env, { id: issueId, title: "테스트", description: "설명", assigneeId: null });
  assert.equal(created.identifier, "OT1-1");
  const assigned = await assignLinearIssue(env, issueId, assigneeId);
  assert.equal(assigned.assignee.id, assigneeId);
  await inviteLinearGuest(env, "33333333-3333-4333-8333-333333333333", "operator@example.com");
  const invite = calls.find((call) => call.query.includes("organizationInviteCreate"));
  assert.deepEqual(invite.variables.input, {
    id: "33333333-3333-4333-8333-333333333333",
    email: "operator@example.com",
    role: "guest",
    teamIds: [teamId],
  });
  assert.equal(invite.authorization, "lin_api_admin");
  issue = { ...issue, team: { id: "44444444-4444-4444-8444-444444444444", key: "DEV" } };
  await assert.rejects(() => assignLinearIssue(env, issueId, assigneeId), LinearApiError);
  console.log("PASS Linear bridge: OT1-only issue create/readback, human DRI assignment and guest invite boundary");
} finally {
  globalThis.fetch = original;
}
