interface SiteEnv {
  readonly ASSETS: Fetcher;
  readonly CORE: Fetcher;
  readonly RATE_LIMITER: RateLimit;
  readonly SITE_CORE_HMAC_SECRET?: string;
  readonly EVENT_CORE_HMAC_SECRET?: string;
  readonly SLACK_SHARED_INVITE_URL?: string;
}

const EVENT_SCHEDULE = /^\/events\/schedule\/([A-Za-z0-9_-]{20,1900}\.[0-9a-f]{64})$/;
const EVENT_API = /^\/bridge\/(state|configure|vote|finalize)$/;
const GENERIC_ERROR = "요청을 지금 처리할 수 없어요. 잠시 뒤 새로 확인해 주세요.";
export const CANONICAL_ORIGIN = "https://ot1l.hyuk.me";
const LEGACY_HOSTNAME = "otl1.hyuk.me";

const securityHeaders = {
  "Content-Security-Policy": `default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self' ${CANONICAL_ORIGIN}; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; upgrade-insecure-requests`,
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Referrer-Policy": "strict-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

function secured(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
  if ((headers.get("content-type") ?? "").includes("text/html"))
    headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function hex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function sha256(value: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
export async function createSiteCoreSignature(
  method: string,
  path: string,
  body: string,
  timestamp: number,
  nonce: string,
): Promise<(secret: string) => Promise<string>> {
  const canonical = [method.toUpperCase(), path, await sha256(body), String(timestamp), nonce].join(
    "\n",
  );
  return async (secret: string) => {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical)));
  };
}

function base64Url(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
function randomToken(bytes: number): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}
async function coreRequest(
  env: SiteEnv,
  path: string,
  payload: object,
  secret = env.SITE_CORE_HMAC_SECRET,
): Promise<Response> {
  if (!secret) throw new Error("site core signing unavailable");
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomToken(18);
  const sign = await createSiteCoreSignature("POST", path, body, timestamp, nonce);
  return env.CORE.fetch(
    new Request(`https://core.invalid${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-otl-timestamp": String(timestamp),
        "x-otl-nonce": nonce,
        "x-otl-signature": await sign(secret),
      },
      body,
    }),
  );
}

async function assetHtml(env: SiteEnv, request: Request, name: string): Promise<string> {
  return (await env.ASSETS.fetch(new Request(new URL(`/${name}`, request.url)))).text();
}
async function eventSchedulePage(request: Request, env: SiteEnv, token: string): Promise<Response> {
  const html = await assetHtml(env, request, "event-schedule.html");
  return new Response(html.replace("__EVENT_TOKEN__", escapeHtml(token)), {
    headers: { "content-type": "text/html;charset=UTF-8" },
  });
}
async function eventScheduleApi(
  request: Request,
  env: SiteEnv,
  operation: string,
): Promise<Response> {
  if (
    !(
      await env.RATE_LIMITER.limit({
        key: `event:${request.headers.get("cf-connecting-ip") ?? "unknown"}`,
      })
    ).success
  )
    return Response.json({ error: "rate_limited" }, { status: 429 });
  if (Number(request.headers.get("content-length") ?? "0") > 32_768)
    return Response.json({ error: "invalid_request" }, { status: 413 });
  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError)
      return Response.json({ error: "invalid_request" }, { status: 400 });
    throw error;
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload))
    return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    const response = await coreRequest(
      env,
      `/internal/events/${operation}`,
      payload,
      env.EVENT_CORE_HMAC_SECRET,
    );
    return new Response(response.body, {
      status: response.status,
      headers: { "content-type": "application/json;charset=UTF-8", "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof Error) return Response.json({ error: "unavailable" }, { status: 503 });
    throw error;
  }
}
function message(messageText: string, status: number): Response {
  return new Response(
    `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/styles.css"><body class="status-page"><main><p class="eyebrow">ONE THING</p><h1>${messageText}</h1><a href="/">처음으로</a></main></body></html>`,
    { status, headers: { "content-type": "text/html;charset=UTF-8" } },
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
function sharedInviteUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.host !== "join.slack.com" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    if (!/^\/t\/[A-Za-z0-9_-]+\/shared_invite\/[A-Za-z0-9_~-]+$/.test(url.pathname)) return null;
    return url.href;
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

function sharedInviteRedirect(url: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location: url,
      "cache-control": "no-store, max-age=0",
    },
  });
}

const siteWorker = {
  async fetch(request: Request, env: SiteEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname === LEGACY_HOSTNAME) {
      url.protocol = "https:";
      url.hostname = new URL(CANONICAL_ORIGIN).hostname;
      return secured(Response.redirect(url, 308));
    }
    const eventSchedule = url.pathname.match(EVENT_SCHEDULE);
    const eventApi = url.pathname.match(EVENT_API);
    let response: Response;
    if (request.method === "GET" && url.pathname === "/health") {
      const configured = Boolean(env.ASSETS && env.CORE && env.RATE_LIMITER && env.SITE_CORE_HMAC_SECRET);
      response = Response.json({status: configured ? "ok" : "unconfigured", service: "otl1-site", configured}, {status:configured ? 200 : 503});
    } else if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = await assetHtml(env, request, "index.html");
      response = new Response(html, { headers: { "content-type": "text/html;charset=UTF-8" } });
    } else if (request.method === "GET" && eventSchedule)
      response = await eventSchedulePage(request, env, eventSchedule[1]);
    else if (request.method === "POST" && eventApi)
      response = await eventScheduleApi(request, env, eventApi[1]);
    else if (request.method === "GET" && url.pathname === "/join") {
      const slackInvite = sharedInviteUrl(env.SLACK_SHARED_INVITE_URL);
      response = slackInvite
        ? sharedInviteRedirect(slackInvite)
        : message(GENERIC_ERROR, 503);
    } else response = await env.ASSETS.fetch(request);
    return secured(response);
  },
} satisfies ExportedHandler<SiteEnv>;
export default siteWorker;
