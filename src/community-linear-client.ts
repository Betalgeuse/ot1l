import type { CommunityEnv } from "./community-runtime";
import { InputError, type Json, list, object, string } from "./input";

type LinearEnv = Pick<
  CommunityEnv,
  | "LINEAR_API_KEY"
  | "LINEAR_ADMIN_API_KEY"
  | "LINEAR_APP_CLIENT_ID"
  | "LINEAR_APP_CLIENT_SECRET"
  | "LINEAR_TEAM_ID"
  | "LINEAR_ORGANIZATION_ID"
>;
const ISSUE_FIELDS =
  "id identifier title description url updatedAt team { id key } assignee { id } creator { id } state { id name type }";

export class LinearApiError extends Error {
  constructor(readonly code: string) {
    super(`Linear operation failed: ${code}`);
  }
}

export function configuredLinearTeam(env: LinearEnv): string {
  const issueCredential = Boolean(
    env.LINEAR_API_KEY ||
      (/^[a-f0-9]{32}$/.test(env.LINEAR_APP_CLIENT_ID ?? "") && env.LINEAR_APP_CLIENT_SECRET),
  );
  if (
    !issueCredential ||
    !/^[a-f0-9-]{36}$/.test(env.LINEAR_TEAM_ID ?? "") ||
    !env.LINEAR_ORGANIZATION_ID
  )
    throw new InputError("Linear 연결을 준비 중이에요. 아직 완료로 처리하지 않습니다.");
  return string(env.LINEAR_TEAM_ID);
}

async function appCredential(env: LinearEnv): Promise<string> {
  if (!env.LINEAR_APP_CLIENT_ID || !env.LINEAR_APP_CLIENT_SECRET) return string(env.LINEAR_API_KEY);
  let response: Response;
  try {
    response = await fetch("https://api.linear.app/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${env.LINEAR_APP_CLIENT_ID}:${env.LINEAR_APP_CLIENT_SECRET}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "read,write,app:assignable,app:mentionable",
      }),
      signal: AbortSignal.timeout(6000),
      redirect: "manual",
    });
  } catch {
    throw new LinearApiError("app_auth_transport");
  }
  if (!response.ok) throw new LinearApiError(`app_auth_http_${response.status}`);
  const body = object(await response.json());
  if (
    body.token_type !== "Bearer" ||
    typeof body.access_token !== "string" ||
    body.access_token.length < 32
  )
    throw new LinearApiError("app_auth_response");
  return `Bearer ${body.access_token}`;
}

export async function linearRequest(
  env: LinearEnv,
  query: string,
  variables: Record<string, Json>,
  admin = false,
  missingEntity?: "Issue" | "OrganizationInvite",
): Promise<Record<string, unknown> | null> {
  configuredLinearTeam(env);
  const credential = admin ? env.LINEAR_ADMIN_API_KEY : await appCredential(env);
  if (!credential) throw new InputError("Linear 회원 관리 연결을 확인해 주세요.");
  let response: Response;
  try {
    response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { Authorization: credential, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(6000),
      redirect: "manual",
    });
  } catch {
    throw new LinearApiError("transport");
  }
  if (!response.ok && response.status !== 400) throw new LinearApiError(`http_${response.status}`);
  const body = object(await response.json());
  const errors = Array.isArray(body.errors) ? body.errors.map(object) : [];
  if (errors.length) {
    if (
      missingEntity &&
      errors.length === 1 &&
      errors[0]?.message === `Entity not found: ${missingEntity}` &&
      object(errors[0].extensions).code === "INPUT_ERROR"
    )
      return null;
    throw new LinearApiError(string(object(errors[0]?.extensions ?? {}).code ?? "graphql"));
  }
  if (!response.ok || body.data === null || body.data === undefined)
    throw new LinearApiError("invalid_response");
  return object(body.data);
}

export async function linearTeamMembers(
  env: LinearEnv,
): Promise<readonly Record<string, unknown>[]> {
  const members: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const data = await linearRequest(
      env,
      "query($id:String!,$after:String){team(id:$id){id key organization{id} members(first:100,after:$after){nodes{id name email guest active teamMemberships{nodes{id team{id}}}} pageInfo{hasNextPage endCursor}}}}",
      { id: configuredLinearTeam(env), after: cursor },
    );
    const team = object(data?.team);
    if (
      team.id !== env.LINEAR_TEAM_ID ||
      team.key !== "OT1" ||
      object(team.organization).id !== env.LINEAR_ORGANIZATION_ID
    )
      throw new LinearApiError("team_boundary");
    const connection = object(team.members);
    members.push(...list(connection.nodes).map(object));
    const info = object(connection.pageInfo);
    if (info.hasNextPage !== true) return members;
    cursor = string(info.endCursor);
  }
  throw new LinearApiError("member_pagination_limit");
}

export async function linearIssue(
  env: LinearEnv,
  id: string,
): Promise<Record<string, unknown> | null> {
  const result = await linearRequest(
    env,
    `query($id:String!){issue(id:$id){${ISSUE_FIELDS}}}`,
    { id },
    false,
    "Issue",
  );
  if (!result) return null;
  const issue = object(result.issue);
  if (object(issue.team).id !== configuredLinearTeam(env) || object(issue.team).key !== "OT1")
    throw new LinearApiError("team_boundary");
  return issue;
}

export async function createLinearIssue(
  env: LinearEnv,
  input: { id: string; title: string; description: string; assigneeId: string | null },
): Promise<Record<string, unknown>> {
  const existing = await linearIssue(env, input.id);
  if (existing) return existing;
  const result = await linearRequest(
    env,
    `mutation($input:IssueCreateInput!){issueCreate(input:$input){success issue{${ISSUE_FIELDS}}}}`,
    { input: { ...input, teamId: configuredLinearTeam(env) } },
  );
  if (object(result?.issueCreate).success !== true)
    throw new LinearApiError("issue_create_rejected");
  const confirmed = await linearIssue(env, input.id);
  if (!confirmed) throw new LinearApiError("issue_create_unconfirmed");
  return confirmed;
}

export async function assignLinearIssue(
  env: LinearEnv,
  id: string,
  assigneeId: string,
): Promise<Record<string, unknown>> {
  if (!(await linearIssue(env, id))) throw new InputError("Linear 이슈를 찾을 수 없어요.");
  const candidates = await linearTeamMembers(env);
  if (!candidates.some((member) => member.id === assigneeId && member.active === true))
    throw new InputError("지금 ot1l 팀에서 작업할 수 있는 담당자를 골라 주세요.");
  const result = await linearRequest(
    env,
    "mutation($id:String!,$input:IssueUpdateInput!){issueUpdate(id:$id,input:$input){success}}",
    { id, input: { assigneeId } },
  );
  if (object(result?.issueUpdate).success !== true) throw new LinearApiError("assignment_rejected");
  const confirmed = await linearIssue(env, id);
  if (!confirmed) throw new LinearApiError("assignment_unconfirmed");
  return confirmed;
}

export async function inviteLinearGuest(env: LinearEnv, id: string, email: string): Promise<void> {
  const existing = await linearRequest(
    env,
    "query($id:String!){organizationInvite(id:$id){id email role acceptedAt}}",
    { id },
    true,
    "OrganizationInvite",
  );
  if (existing) {
    const invite = object(existing.organizationInvite);
    if (invite.role !== "guest" || string(invite.email).toLowerCase() !== email.toLowerCase())
      throw new LinearApiError("invite_boundary");
    return;
  }
  const result = await linearRequest(
    env,
    "mutation($input:OrganizationInviteCreateInput!){organizationInviteCreate(input:$input){success organizationInvite{id role}}}",
    { input: { id, email, role: "guest", teamIds: [configuredLinearTeam(env)] } },
    true,
  );
  const operation = object(result?.organizationInviteCreate);
  if (operation.success !== true || object(operation.organizationInvite).role !== "guest")
    throw new LinearApiError("invite_rejected");
}

export async function removeLinearTeamMember(env: LinearEnv, linearUserId: string): Promise<void> {
  const member = (await linearTeamMembers(env)).find((candidate) => candidate.id === linearUserId);
  if (!member) return;
  if (member.guest !== true)
    throw new InputError("기존 일반 계정의 권한은 변경하지 않습니다. Founder에게 문의해 주세요.");
  const membership = list(object(member.teamMemberships).nodes)
    .map(object)
    .find((entry) => object(entry.team).id === configuredLinearTeam(env));
  if (!membership) return;
  const result = await linearRequest(
    env,
    "mutation($id:String!){teamMembershipDelete(id:$id){success}}",
    { id: string(membership.id) },
    true,
  );
  if (object(result?.teamMembershipDelete).success !== true)
    throw new LinearApiError("membership_remove_rejected");
}

export async function suspendLinearGuest(env: LinearEnv, linearUserId: string): Promise<void> {
  const member = (await linearTeamMembers(env)).find((candidate) => candidate.id === linearUserId);
  if (!member) return;
  if (member.guest !== true)
    throw new InputError("기존 일반 계정의 권한은 변경하지 않습니다. Founder에게 문의해 주세요.");
  const result = await linearRequest(
    env,
    "mutation($id:String!){userSuspend(id:$id){success}}",
    { id: linearUserId },
    true,
  );
  if (object(result?.userSuspend).success !== true)
    throw new LinearApiError("guest_suspend_rejected");
}

export async function unsuspendLinearGuest(env: LinearEnv, linearUserId: string): Promise<void> {
  const member = (await linearTeamMembers(env)).find((candidate) => candidate.id === linearUserId);
  if (!member) throw new InputError("기존 Linear 계정을 확인할 수 없어요.");
  if (member.guest !== true)
    throw new InputError("기존 일반 계정의 권한은 변경하지 않습니다. Founder에게 문의해 주세요.");
  const result = await linearRequest(
    env,
    "mutation($id:String!){userUnsuspend(id:$id){success}}",
    { id: linearUserId },
    true,
  );
  if (object(result?.userUnsuspend).success !== true)
    throw new LinearApiError("guest_unsuspend_rejected");
}

export async function cancelLinearGuestInvite(env: LinearEnv, inviteId: string): Promise<void> {
  const existing = await linearRequest(
    env,
    "query($id:String!){organizationInvite(id:$id){id role acceptedAt}}",
    { id: inviteId },
    true,
    "OrganizationInvite",
  );
  if (!existing) return;
  const invite = object(existing.organizationInvite);
  if (invite.role !== "guest" || invite.acceptedAt !== null)
    throw new LinearApiError("invite_boundary");
  const result = await linearRequest(
    env,
    "mutation($id:String!){organizationInviteDelete(id:$id){success}}",
    { id: inviteId },
    true,
  );
  if (object(result?.organizationInviteDelete).success !== true)
    throw new LinearApiError("invite_cancel_rejected");
}
