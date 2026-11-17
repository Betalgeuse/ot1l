import type { Env } from "./index";
import { NeonStore } from "./store";

type Sql = Pick<NeonStore, "queryJson">;
type WebhookEnv = Pick<Env, "DATABASE_URL" | "OCTO_DECISION_WEBHOOK_SECRET">;

const TOLERANCE_SECONDS = 300;
const MAX_BODY_BYTES = 16_384;
const FIELDS = ["approval_ref", "unit", "intent", "choice", "via"] as const;
const encoder = new TextEncoder();

const respond = (status: number, body: Record<string, string>) => Response.json(body, { status });
const fail = (status: number, error: string) => respond(status, { error });

function base64Bytes(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

// Standard Webhooks: HMAC-SHA256 over `${id}.${timestamp}.${body}`, base64 signatures.
export async function verifyStandardWebhook(
  secret: string,
  id: string,
  timestamp: string,
  body: string,
  signatureHeader: string,
): Promise<boolean> {
  const keyBytes = base64Bytes(secret.replace(/^whsec_/, ""));
  if (!keyBytes?.length) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const message = encoder.encode(`${id}.${timestamp}.${body}`);
  let ok = false;
  for (const part of signatureHeader.split(" ")) {
    const [version, value] = part.split(",");
    const signature = version === "v1" && value ? base64Bytes(value) : null;
    if (signature && (await crypto.subtle.verify("HMAC", key, signature, message))) ok = true;
  }
  return ok;
}

type Receipt = {
  readonly decisionId: string;
  readonly version: number;
  readonly effectName: string;
  readonly fields: Record<(typeof FIELDS)[number], string>;
};

function parseReceipt(raw: string): Receipt | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const { type, timestamp, data } = body as Record<string, unknown>;
  if (type !== "decision.made" || typeof timestamp !== "string") return null;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  const str = (v: unknown): v is string => typeof v === "string" && v.length <= 512;
  if (!str(d.decision_id) || !d.decision_id) return null;
  if (!Number.isSafeInteger(d.version) || (d.version as number) < 0) return null;
  const fields = {} as Record<(typeof FIELDS)[number], string>;
  for (const name of FIELDS) {
    const v = d[name];
    if (!str(v)) return null;
    fields[name] = v;
  }
  const effect = d.effect;
  if (typeof effect !== "object" || effect === null || Array.isArray(effect)) return null;
  const name = (effect as Record<string, unknown>).name;
  if (typeof name !== "string" || !name || name.length > 64) return null;
  return { decisionId: d.decision_id, version: d.version as number, effectName: name, fields };
}

export async function handleOctoDecisionWebhook(
  request: Request,
  env: WebhookEnv,
  now: () => number = Date.now,
): Promise<Response> {
  if (request.method !== "POST")
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  if (!env.OCTO_DECISION_WEBHOOK_SECRET) return fail(503, "unavailable");
  const id = request.headers.get("webhook-id");
  const timestamp = request.headers.get("webhook-timestamp");
  const signature = request.headers.get("webhook-signature");
  if (!id || id.length > 256 || !timestamp || !/^\d{1,12}$/.test(timestamp) || !signature)
    return fail(400, "headers");
  if (Math.abs(Math.floor(now() / 1000) - Number(timestamp)) > TOLERANCE_SECONDS)
    return fail(401, "unauthorized");
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return fail(400, "body");
  let verified: boolean;
  try {
    verified = await verifyStandardWebhook(
      env.OCTO_DECISION_WEBHOOK_SECRET,
      id,
      timestamp,
      raw,
      signature,
    );
  } catch {
    return fail(503, "unavailable");
  }
  if (!verified) return fail(401, "unauthorized");
  const receipt = parseReceipt(raw);
  if (!receipt) return fail(400, "body");
  try {
    const result = await new NeonStore(env.DATABASE_URL).queryJson(
      "SELECT otl.octo_decision_receipt_record($1::jsonb)",
      [
        JSON.stringify({
          webhookId: id,
          decisionId: receipt.decisionId,
          approvalRef: receipt.fields.approval_ref,
          unit: receipt.fields.unit,
          intent: receipt.fields.intent,
          choice: receipt.fields.choice,
          via: receipt.fields.via,
          effectName: receipt.effectName,
          version: receipt.version,
          bodySha256: hex(await crypto.subtle.digest("SHA-256", encoder.encode(raw))),
        }),
      ],
    );
    const status = (result as { status?: unknown } | null)?.status;
    if (status === "accepted") return respond(202, { status: "accepted", webhook_id: id });
    if (status === "duplicate") return respond(200, { status: "duplicate" });
  } catch {
    // fall through: never log the body or the secret
  }
  return fail(503, "unavailable");
}

// Runs inside the :01/:31 maintenance window (team task decision_receipts).
export async function purgeDecisionWebhookReceipts(sql: Sql): Promise<void> {
  await sql.queryJson("SELECT otl.octo_decision_receipt_purge()", []);
}
