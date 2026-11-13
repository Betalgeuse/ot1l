interface SiteEnv {
  readonly ASSETS: Fetcher;
  readonly CORE: Fetcher;
  readonly RATE_LIMITER: RateLimit;
  readonly SITE_CORE_HMAC_SECRET?: string;
  readonly SLACK_SHARED_INVITE_URL?: string;
}

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

async function assetHtml(env: SiteEnv, request: Request, name: string): Promise<string> {
  return (await env.ASSETS.fetch(new Request(new URL(`/${name}`, request.url)))).text();
}
function message(messageText: string, status: number): Response {
  return new Response(
    `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/styles.css"><body class="status-page"><main><p class="eyebrow">ONE THING</p><h1>${messageText}</h1><a href="/">처음으로</a></main></body></html>`,
    { status, headers: { "content-type": "text/html;charset=UTF-8" } },
  );
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
    let response: Response;
    if (request.method === "GET" && url.pathname === "/health") {
      const configured = Boolean(env.ASSETS && env.CORE && env.RATE_LIMITER && env.SITE_CORE_HMAC_SECRET);
      response = Response.json({status: configured ? "ok" : "unconfigured", service: "otl1-site", configured}, {status:configured ? 200 : 503});
    } else if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = await assetHtml(env, request, "index.html");
      response = new Response(html, { headers: { "content-type": "text/html;charset=UTF-8" } });
    } else if (request.method === "GET" && url.pathname === "/join") {
      const slackInvite = sharedInviteUrl(env.SLACK_SHARED_INVITE_URL);
      response = slackInvite
        ? sharedInviteRedirect(slackInvite)
        : message(GENERIC_ERROR, 503);
    } else if (request.method === "GET" && url.pathname === "/metrics/weekly-recorders") {
      // Aggregate-only snapshot served by the core Worker; the core reads it from its clock, never Neon.
      const upstream = await env.CORE.fetch(new Request("https://core/metrics/weekly-recorders"));
      response = new Response(upstream.body, {
        status: upstream.status,
        headers: { "content-type": "application/json", "cache-control": "public, max-age=300" },
      });
    } else response = await env.ASSETS.fetch(request);
    return secured(response);
  },
} satisfies ExportedHandler<SiteEnv>;
export default siteWorker;
