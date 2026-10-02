interface EventSiteEnv {
  readonly ASSETS: Fetcher;
  readonly CORE: Fetcher;
  readonly RATE_LIMITER: RateLimit;
  readonly EVENT_CORE_HMAC_SECRET?: string;
}

const EVENT_SCHEDULE = /^\/events\/schedule\/([A-Za-z0-9_-]{20,1900}\.[0-9a-f]{64})$/;
const EVENT_API = /^\/api\/event-time\/(state|configure|vote|finalize)$/;
const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; upgrade-insecure-requests",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

function secured(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, headers });
}

function hex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signature(secret: string, method: string, path: string, body: string, timestamp: number, nonce: string): Promise<string> {
  const digest = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
  const canonical = [method.toUpperCase(), path, digest, String(timestamp), nonce].join("\n");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical)));
}

function randomToken(bytes: number): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

async function eventPage(request: Request, env: EventSiteEnv, token: string): Promise<Response> {
  const asset = await env.ASSETS.fetch(new Request(new URL("/event-schedule.html", request.url)));
  if (!asset.ok) return new Response("Not found", { status: 404 });
  return new Response((await asset.text()).replace("__EVENT_TOKEN__", escapeHtml(token)), {
    headers: { "content-type": "text/html;charset=UTF-8" },
  });
}

async function eventApi(request: Request, env: EventSiteEnv, operation: string): Promise<Response> {
  if (!(await env.RATE_LIMITER.limit({ key: `event:${request.headers.get("cf-connecting-ip") ?? "unknown"}` })).success)
    return Response.json({ error: "rate_limited" }, { status: 429 });
  if (!env.EVENT_CORE_HMAC_SECRET) return Response.json({ error: "unavailable" }, { status: 503 });
  if (Number(request.headers.get("content-length") ?? "0") > 32_768)
    return Response.json({ error: "invalid_request" }, { status: 413 });
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 32_768)
    return Response.json({ error: "invalid_request" }, { status: 413 });
  try { JSON.parse(body); } catch { return Response.json({ error: "invalid_request" }, { status: 400 }); }
  const path = `/internal/events/${operation}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomToken(18);
  try {
    const response = await env.CORE.fetch(new Request(`https://core.invalid${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-otl-timestamp": String(timestamp),
        "x-otl-nonce": nonce,
        "x-otl-signature": await signature(env.EVENT_CORE_HMAC_SECRET, "POST", path, body, timestamp, nonce),
      },
      body,
    }));
    return new Response(response.body, {
      status: response.status,
      headers: { "content-type": "application/json;charset=UTF-8", "cache-control": "no-store" },
    });
  } catch { return Response.json({ error: "unavailable" }, { status: 503 }); }
}

export default {
  async fetch(request: Request, env: EventSiteEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health")
      return Response.json({ status: "ok", service: "open-events", configured: Boolean(env.EVENT_CORE_HMAC_SECRET) });
    const page = url.pathname.match(EVENT_SCHEDULE);
    if (request.method === "GET" && page) return secured(await eventPage(request, env, page[1]));
    const api = url.pathname.match(EVENT_API);
    if (request.method === "POST" && api) return secured(await eventApi(request, env, api[1]));
    if (
      request.method === "GET" &&
      ["/event-schedule.js", "/styles.css"].includes(url.pathname)
    )
      return secured(await env.ASSETS.fetch(request));
    return secured(new Response("Not found", { status: 404 }));
  },
};
