// Purge-only path for applicant data stored before referral, invite and interest intake were removed.
// It deletes expired R2 payloads and marks them purged; it accepts no new data and sends no Slack message.
// docs/OPERATIONS.md keeps retention running after the feature flags close. Remove this file once the
// stored data is drained (no pending rows in referral_private_payloads and interest_private_payloads).
import type { CommunityEnv } from "./community-runtime";
import { object, string } from "./input";
import { runtimeFailureCode } from "./runtime-failure";
import { NeonStore } from "./store";
import { StoreError } from "./store-types";

const BATCH = 10;
const INTEREST_BATCH = 2;
const INTEREST_OBJECT = /^interest-private\/IREQ-[A-Z0-9-]{4,64}\/revision-[0-9]+-[0-9a-f-]+\.enc$/;

export type ApplicantRetentionResult = { readonly possiblyMore: boolean; readonly failed: boolean };
type QueryStore = Pick<NeonStore, "queryJson">;

async function purgeReferral(env: CommunityEnv, db: QueryStore, now: string): Promise<boolean> {
  const bucket = env.INVITE_PRIVATE_OBJECTS;
  if (!bucket) throw new StoreError("configuration");
  for (let i = 0; i < BATCH; i += 1) {
    const raw = await db.queryJson("SELECT otl.referral_runtime_execute('claim_purge',$1::jsonb)", [
      JSON.stringify({ teamId: env.SLACK_TEAM_ID, now }),
    ]);
    if (raw === null) return false;
    const claimed = object(raw);
    let status: "purged" | "failed" = "purged";
    try {
      await bucket.delete(string(claimed.opaqueRef));
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      status = "failed";
    }
    await db.queryJson("SELECT otl.referral_runtime_execute('finish_purge',$1::jsonb)", [
      JSON.stringify({
        teamId: env.SLACK_TEAM_ID,
        requestId: string(claimed.requestId),
        key: string(claimed.claimKey),
        status,
        now,
      }),
    ]);
  }
  return true;
}

async function purgeInterest(
  env: CommunityEnv,
  makeStore: (url: string) => QueryStore,
  now: string,
): Promise<boolean> {
  const bucket = env.INVITE_PRIVATE_OBJECTS;
  if (!env.INTEREST_RUNTIME_DATABASE_URL || !bucket) throw new StoreError("configuration");
  const store = makeStore(env.INTEREST_RUNTIME_DATABASE_URL);
  const call = (op: string, input: object) =>
    store.queryJson("SELECT otl.interest_retention_execute($1,$2::jsonb)", [
      op,
      JSON.stringify({ teamId: env.SLACK_TEAM_ID, now, ...input }),
    ]);
  await call("expire_due", { limit: BATCH });
  let more = true;
  for (let i = 0; i < INTEREST_BATCH; i += 1) {
    const key = crypto.randomUUID();
    const raw = await call("claim_purge", { key });
    if (raw === null) {
      more = false;
      break;
    }
    const row = object(raw);
    const opaqueRef = string(row.opaqueRef);
    let status: "purged" | "failed" = "purged";
    try {
      if (!INTEREST_OBJECT.test(opaqueRef)) throw new StoreError("response");
      await bucket.delete(opaqueRef);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      status = "failed";
    }
    await call("finish_purge", { key, interestId: string(row.interestId), status });
  }
  await call("audit_retention", { limit: BATCH });
  return more;
}

export async function runApplicantRetention(
  env: CommunityEnv,
  db: QueryStore,
  now: number,
  makeStore: (url: string) => QueryStore = (url) => new NeonStore(url),
): Promise<ApplicantRetentionResult> {
  const iso = new Date(now).toISOString();
  let possiblyMore = false;
  let failed = false;
  const attempt = async (queue: string, work: () => Promise<boolean>): Promise<void> => {
    try {
      possiblyMore = (await work()) || possiblyMore;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      failed = true;
      console.error(
        JSON.stringify({
          event: "community.membership.queue.failed",
          queue,
          errorType: error.name,
          errorCode: error instanceof StoreError ? error.code : runtimeFailureCode(error),
        }),
      );
    }
  };
  await attempt("referral_purge", () => purgeReferral(env, db, iso));
  await attempt("interest_purge", () => purgeInterest(env, makeStore, iso));
  return { possiblyMore, failed };
}
