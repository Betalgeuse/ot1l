interface EventSiteEnv {
  readonly ASSETS: Fetcher;
}

// The event schedule feature is closed. Only the health probe the deployer checks stays.
const CLOSED_PAGE = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:system-ui,sans-serif;margin:15vh auto;max-width:32rem;padding:0 1rem"><main><p>ONE THING</p><h1>모임 일정 기능은 종료되었습니다. 모임은 Slack에서 안내합니다.</h1></main></body></html>`;
const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; style-src 'self' 'unsafe-inline'; upgrade-insecure-requests",
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

export default {
  async fetch(request: Request, _env: EventSiteEnv): Promise<Response> {
    if (request.method === "GET" && new URL(request.url).pathname === "/health")
      return secured(Response.json({ status: "ok", service: "open-events", configured: true }));
    return secured(
      new Response(CLOSED_PAGE, {
        status: 410,
        headers: { "content-type": "text/html;charset=UTF-8" },
      }),
    );
  },
};
