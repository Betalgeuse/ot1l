interface SiteEnv {
  readonly ASSETS: Fetcher;
  readonly CORE: Fetcher;
  readonly RATE_LIMITER: RateLimit;
  readonly TURNSTILE_SITE_KEY: string;
  readonly TURNSTILE_SECRET?: string;
  readonly SITE_CORE_HMAC_SECRET?: string;
  readonly EVENT_CORE_HMAC_SECRET?: string;
  readonly SLACK_SHARED_INVITE_URL?: string;
  readonly PUBLIC_INTEREST_ENABLED?: string;
}

type TurnstileResult = {
  readonly success?: boolean;
  readonly action?: string;
  readonly hostname?: string;
};
const DIRECT_JOIN_PATH = "/internal/referrals/direct-join";
const WITHDRAW_PATH = "/internal/referrals/withdraw";
const RESOLVE_PATH = "/internal/referrals/resolve";
const INTEREST_SUBMIT_PATH = "/internal/interest/submit";
const INTEREST_WITHDRAW_PATH = "/internal/interest/withdraw";
const MAINTAINER_STATUS_PATH = "/internal/maintainers/status";
const REFERRAL = /^\/r\/([A-Za-z0-9_-]{32})$/;
const APPLY = /^\/r\/([A-Za-z0-9_-]{32})\/apply$/;
const RECEIPT = /^\/receipt\/(RCP-[A-Z0-9-]{4,64})$/;
const WITHDRAW = /^\/receipt\/(RCP-[A-Z0-9-]{4,64})\/withdraw$/;
const INTEREST_RECEIPT = /^\/receipt\/(INT-[A-Z0-9-]{4,64})$/;
const INTEREST_WITHDRAW = /^\/receipt\/(INT-[A-Z0-9-]{4,64})\/withdraw$/;
const EVENT_SCHEDULE = /^\/events\/schedule\/([A-Za-z0-9_-]{20,1900}\.[0-9a-f]{64})$/;
const EVENT_API = /^\/bridge\/(state|configure|vote|finalize)$/;
const GENERIC_ERROR = "요청을 지금 처리할 수 없어요. 잠시 뒤 새로 확인해 주세요.";
export const CANONICAL_ORIGIN = "https://ot1l.hyuk.me";
const LEGACY_HOSTNAME = "otl1.hyuk.me";

export const SHARE_COPY = (token: string): string =>
  `매일 제일 중요한 일 하나 정해서 같이 끝내는 모임이야. 같이 할래?\n${CANONICAL_ORIGIN}/r/${token}`;

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
function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(
    value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4),
  );
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
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

async function cookieKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`withdraw-cookie-v1\n${secret}`),
  );
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function sealCapability(
  secret: string,
  receiptId: string,
  token: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(receiptId) },
    await cookieKey(secret),
    new TextEncoder().encode(`${Date.now()}\n${token}`),
  );
  return `${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`;
}
export async function openCapability(
  secret: string,
  receiptId: string,
  sealed: string,
): Promise<string | null> {
  try {
    const [ivValue, bodyValue] = sealed.split(".");
    if (!ivValue || !bodyValue) return null;
    const clear = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decodeBase64Url(ivValue),
        additionalData: new TextEncoder().encode(receiptId),
      },
      await cookieKey(secret),
      decodeBase64Url(bodyValue),
    );
    const [issuedValue, token] = new TextDecoder().decode(clear).split("\n");
    const issuedAt = Number(issuedValue);
    return /^\d{13}$/.test(issuedValue ?? "") &&
      Number.isSafeInteger(issuedAt) &&
      issuedAt <= Date.now() &&
      Date.now() - issuedAt <= 30 * 24 * 60 * 60 * 1000 &&
      /^[A-Za-z0-9_-]{43}$/.test(token ?? "")
      ? token
      : null;
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}

function safeText(value: FormDataEntryValue | null, max: number): string | null {
  if (typeof value !== "string" || /[\u0000-\u001F\u007F\uFFFD]|[\uD800-\uDFFF]/u.test(value))
    return null;
  const normalized = value.trim().normalize("NFC");
  return normalized && Array.from(normalized).length <= max ? normalized : null;
}
async function boundedForm(request: Request): Promise<FormData | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > 16_384) {
      await reader.cancel();
      return null;
    }
    chunks.push(part.value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request.url, {
    method: "POST",
    headers: { "content-type": request.headers.get("content-type") ?? "" },
    body,
  }).formData();
}
async function verifyTurnstile(
  request: Request,
  env: SiteEnv,
  token: string,
  action = "invite-apply",
): Promise<"valid" | "invalid" | "unavailable"> {
  if (!env.TURNSTILE_SECRET || !token || token.length > 2048) return "invalid";
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(8_000),
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET,
        response: token,
        remoteip: request.headers.get("cf-connecting-ip") ?? "",
      }),
    });
    if (!response.ok) return "unavailable";
    const result = await response.json<TurnstileResult>();
    const testKey = env.TURNSTILE_SITE_KEY === "1x00000000000000000000AA";
    const metadataValid = testKey
      ? result.action === undefined && result.hostname === "example.com"
      : result.action === action && result.hostname === new URL(request.url).hostname;
    if (result.success !== true || !metadataValid)
      console.warn(
        JSON.stringify({
          event: "turnstile_rejected",
          success: result.success === true,
          metadataValid,
          testKey,
        }),
      );
    return result.success === true && metadataValid ? "valid" : "invalid";
  } catch (error) {
    if (error instanceof Error) return "unavailable";
    throw error;
  }
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
function renderInterestSlots(html: string, env: SiteEnv): string {
  return html
    .replace(
      "__INTEREST_COPY__",
      interestEnabled(env)
        ? "소개 링크가 없다면 운영자에게 비공개 참여 문의를 남길 수 있습니다. 문의만으로 회원이 되거나 초대를 받지는 않습니다."
        : "소개 링크가 없는 분을 위한 비공개 참여 문의를 준비하고 있습니다. 문의만으로 회원이 되거나 초대를 받지는 않습니다.",
    )
    .replace(
      "__INTEREST_CTA__",
      interestEnabled(env)
        ? '<a class="interest-pending" href="/interest">비공개 참여 문의 남기기</a>'
        : '<span class="interest-pending">참여 문의 준비 중</span>',
    );
}
function referralSection(token: string, inviterByline: string): string {
  return `<section class="chapter chapter--paper chapter--referral-hero referral-invite-section" id="referral-invite" aria-labelledby="referral-title">
        <div class="chapter-inner">
          <div class="chapter-label"><span>지인의 소개</span><span>초대</span></div>
          <div class="referral-brand">ONE THING 1 LINE</div>
          <div class="hero-copy reveal">
            <p class="eyebrow">같이 원띵 해요</p>
            <h1 id="referral-title">초대받았어요!</h1>
            <p class="inviter-byline">${inviterByline}</p>
            <p>신뢰하는 지인의 소개로 오늘 가장 중요한 업무 하나를 함께 해냅니다.</p>
            <a class="button slack-join-button" href="/join"><img class="slack-mark" src="/assets/slack-mark.png" width="22" height="22" alt="" aria-hidden="true"><span>Slack에서 함께하기</span></a>
            <div class="share-panel referral-share-panel"><p class="eyebrow">함께하고 싶은 사람에게</p><p id="share-copy">${escapeHtml(SHARE_COPY(token))}</p><button type="button" class="button button--quiet" data-copy aria-describedby="copy-status">초대 문구 복사</button><span id="copy-status" class="copy-status" role="status" aria-live="polite"></span></div>
          </div>
        </div>
      </section>`;
}
function message(messageText: string, status: number): Response {
  return new Response(
    `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/styles.css"><body class="status-page"><main><p class="eyebrow">ONE THING</p><h1>${messageText}</h1><a href="/">처음으로</a></main></body></html>`,
    { status, headers: { "content-type": "text/html;charset=UTF-8" } },
  );
}

type MaintainerStatusItem = {
  readonly title: string;
  readonly lane: "proposed" | "doing" | "review_release" | "needs_help" | "done";
  readonly statusLabel: string;
  readonly hasDri: boolean;
  readonly sourceLabel: string;
  readonly progressSummary: string;
  readonly nextActionLabel: string;
  readonly slackUrl: string;
  readonly updatedAt: string;
};

const MAINTAINER_LANES = [
  { key: "proposed", label: "제안됨", className: "is-new" },
  { key: "doing", label: "진행 중", className: "is-active" },
  { key: "review_release", label: "검토·반영", className: "is-review" },
  { key: "needs_help", label: "도움 필요", className: "is-paused" },
  { key: "done", label: "완료", className: "is-done" },
] as const;

function maintainerBoard(items: readonly MaintainerStatusItem[]): string {
  return MAINTAINER_LANES.map((lane) => {
    const laneItems = items.filter((item) => item.lane === lane.key);
    const cards = laneItems.map((item) => {
      const url = item.slackUrl;
      const date = new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date(item.updatedAt));
      return `<article class="work-card"><div class="work-card__meta"><span>${escapeHtml(item.sourceLabel)}</span><time datetime="${escapeHtml(item.updatedAt)}"><span class="sr-only">마지막 업데이트 </span>${escapeHtml(date)}</time></div><h3>${escapeHtml(item.title)}</h3><dl class="work-card__details"><div><dt>상태</dt><dd>${escapeHtml(item.statusLabel)}</dd></div><div><dt>DRI</dt><dd>${item.hasDri ? "지정됨" : "정하는 중"}</dd></div></dl><p class="work-card__progress">${escapeHtml(item.progressSummary)}</p><p class="work-card__next"><span>다음</span> ${escapeHtml(item.nextActionLabel)}</p><a href="${escapeHtml(url)}" rel="noreferrer" aria-label="${escapeHtml(item.title)} Slack에서 보기">Slack에서 보기 <span aria-hidden="true">↗</span></a></article>`;
    }).join("");
    const empty = cards ? "" : '<p class="work-column__empty">현재 작업이 없어요.</p>';
    return `<section class="work-column ${lane.className}" aria-labelledby="stage-${lane.key}"><header><h2 id="stage-${lane.key}">${lane.label}</h2><span aria-label="${laneItems.length}개">${laneItems.length}</span></header>${cards}${empty}</section>`;
  }).join("");
}

async function maintainerStatusPage(env: SiteEnv): Promise<Response> {
  let items: MaintainerStatusItem[] = [];
  let unavailable = false;
  try {
    const response = await coreRequest(env, MAINTAINER_STATUS_PATH, {});
    if (!response.ok) throw new Error("status unavailable");
    const value: unknown = await response.json();
    if (typeof value !== "object" || value === null || !("items" in value) || !Array.isArray(value.items))
      throw new Error("invalid status response");
    items = value.items.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const item = entry as Record<string, unknown>;
      return typeof item.title === "string" &&
        ["proposed", "doing", "review_release", "needs_help", "done"].includes(String(item.lane)) &&
        typeof item.statusLabel === "string" && typeof item.hasDri === "boolean" &&
        typeof item.sourceLabel === "string" && typeof item.progressSummary === "string" &&
        typeof item.nextActionLabel === "string" && typeof item.slackUrl === "string" &&
        /^https:\/\/app[.]slack[.]com\/client\/[A-Z0-9]+\/[A-Z0-9]+\/thread\/[A-Z0-9]+-\d+[.]\d+$/.test(item.slackUrl) &&
        typeof item.updatedAt === "string"
        ? [{ title: item.title, lane: item.lane as MaintainerStatusItem["lane"],
            statusLabel: item.statusLabel, hasDri: item.hasDri,
            sourceLabel: item.sourceLabel, progressSummary: item.progressSummary,
            nextActionLabel: item.nextActionLabel, slackUrl: item.slackUrl,
            updatedAt: item.updatedAt }]
        : [];
    });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    unavailable = true;
  }
  const board = unavailable
    ? '<div class="work-unavailable" role="status"><h2>작업 현황을 잠시 불러오지 못했어요.</h2><p>진행 중인 작업이 없다는 뜻은 아닙니다. 잠시 뒤 다시 확인하거나 Slack에서 이어가 주세요.</p></div>'
    : maintainerBoard(items);
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="description" content="OT1L 회원 피드백이 실제 기능으로 반영되는 과정을 확인합니다."><title>OT1L · 함께 만드는 중</title><link rel="stylesheet" href="/styles.css"></head><body class="work-page"><a class="skip-link" href="#work-main">본문으로 건너뛰기</a><header class="work-header"><a class="wordmark" href="/"><img src="/assets/otl1-avatar.jpg" width="40" height="40" alt=""><span>ONE THING 1 LINE</span></a><a href="/">모임 소개</a></header><main id="work-main"><div class="work-intro"><p class="eyebrow">함께 만드는 OT1L</p><h1>회원의 의견이<br>어디까지 왔는지 보여드려요.</h1><p>피드백과 대화는 Slack에서 이어집니다. 제안부터 완료까지, 지금 필요한 다음 행동을 한눈에 볼 수 있어요.</p></div><div class="work-board" aria-label="Product Owner 작업 현황">${board}</div></main></body></html>`;
  return new Response(html, { status: unavailable ? 503 : 200, headers: { "content-type": "text/html;charset=UTF-8" } });
}
async function referralPage(request: Request, env: SiteEnv, token: string): Promise<Response> {
  const lookupKey = request.headers.get("cf-connecting-ip") ?? token;
  if (!(await env.RATE_LIMITER.limit({ key: `lookup:${lookupKey}` })).success)
    return message(GENERIC_ERROR, 429);
  const resolved = await availableLink(env, token);
  if (!resolved.available) return message(GENERIC_ERROR, 404);
  const html = await assetHtml(env, request, "index.html");
  const inviterByline = resolved.inviterName
    ? `${escapeHtml(resolved.inviterName)} 님이 같이 원띵 하자고 초대했어요.`
    : "지인의 소개로 이곳에 도착했어요.";
  const canonicalUrl = new URL(request.url);
  canonicalUrl.search = "";
  canonicalUrl.hash = "";
  const directJoinPage = renderInterestSlots(html, env)
    .replace("<!-- __REFERRAL_SLOT__ -->", referralSection(token, inviterByline))
    .replace(
      `<link rel="canonical" href="${CANONICAL_ORIGIN}/">`,
      `<link rel="canonical" href="${escapeHtml(canonicalUrl.href)}">`,
    )
    .replace(
      `<meta property="og:url" content="${CANONICAL_ORIGIN}/">`,
      `<meta property="og:url" content="${escapeHtml(canonicalUrl.href)}">`,
    )
    .replace(
      'content="ONE THING 1 LINE · 오늘 가장 중요한 업무 하나"',
      'content="ONE THING 1 LINE · 같이 원띵 해요"',
    )
    .replace(
      "<title>ONE THING 1 LINE · 오늘 가장 중요한 업무 하나</title>",
      "<title>ONE THING 1 LINE · 함께하기</title>",
    )
    .replace('<a class="wordmark" href="#home"', '<a class="wordmark" href="#referral-invite"')
    .replace('<a href="#invitation">함께하기</a>', '<a href="#referral-invite">Slack 참여</a>');
  return new Response(directJoinPage, { headers: { "content-type": "text/html;charset=UTF-8" } });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function availableLink(
  env: SiteEnv,
  token: string,
): Promise<{ readonly available: boolean; readonly inviterName: string | null }> {
  try {
    const response = await coreRequest(env, RESOLVE_PATH, { referralToken: token });
    if (!response.ok) return { available: false, inviterName: null };
    const result: unknown = await response.json();
    if (
      typeof result !== "object" ||
      result === null ||
      !("available" in result) ||
      result.available !== true
    )
      return { available: false, inviterName: null };
    const inviterName =
      "inviterName" in result &&
      typeof result.inviterName === "string" &&
      [...result.inviterName].length <= 40 &&
      result.inviterName.trim() &&
      !Array.from(result.inviterName).some((character) => character.charCodeAt(0) < 32)
        ? result.inviterName
        : null;
    return { available: true, inviterName };
  } catch (error) {
    if (error instanceof Error) return { available: false, inviterName: null };
    throw error;
  }
}

async function directJoin(request: Request, env: SiteEnv, token: string): Promise<Response> {
  const applicantIp = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (!(await env.RATE_LIMITER.limit({ key: `apply:${applicantIp}` })).success)
    return message(GENERIC_ERROR, 429);
  if (!(await availableLink(env, token)).available) return message(GENERIC_ERROR, 404);
  if (Number(request.headers.get("content-length") ?? "0") > 16_384)
    return message(GENERIC_ERROR, 422);
  let form: FormData;
  try {
    const parsed = await boundedForm(request);
    if (!parsed) return message(GENERIC_ERROR, 422);
    form = parsed;
  } catch (error) {
    if (error instanceof Error) return message(GENERIC_ERROR, 422);
    throw error;
  }
  const email = safeText(form.get("email"), 320)?.toLowerCase() ?? null;
  const submissionKey = safeText(form.get("submissionKey"), 120);
  if (
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !submissionKey ||
    submissionKey.length < 8 ||
    form.get("consent") !== "invite-consent-v1"
  )
    return message(GENERIC_ERROR, 422);
  const turnstile = await verifyTurnstile(
    request,
    env,
    String(form.get("cf-turnstile-response") ?? ""),
  );
  if (turnstile !== "valid") return message(GENERIC_ERROR, turnstile === "invalid" ? 422 : 503);
  const slackInvite = sharedInviteUrl(env.SLACK_SHARED_INVITE_URL);
  if (!slackInvite) return message(GENERIC_ERROR, 503);
  try {
    const response = await coreRequest(env, DIRECT_JOIN_PATH, {
      referralToken: token,
      submissionKey,
      consentVersion: "invite-consent-v1",
      consentedAt: new Date().toISOString(),
      email,
    });
    if (response.status !== 202) return message(GENERIC_ERROR, 503);
    const result: unknown = await response.json();
    if (
      typeof result !== "object" ||
      result === null ||
      !("accepted" in result) ||
      result.accepted !== true
    )
      return message(GENERIC_ERROR, 503);
    return new Response(null, { status: 303, headers: { location: slackInvite } });
  } catch (error) {
    if (error instanceof Error) return message(GENERIC_ERROR, 503);
    throw error;
  }
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

function interestEnabled(env: SiteEnv): boolean {
  return (
    env.PUBLIC_INTEREST_ENABLED === "true" &&
    Boolean(env.SITE_CORE_HMAC_SECRET && env.TURNSTILE_SECRET && env.TURNSTILE_SITE_KEY)
  );
}

async function interestPage(request: Request, env: SiteEnv): Promise<Response> {
  if (!interestEnabled(env)) return message("참여 문의는 아직 준비 중입니다.", 503);
  const html = await assetHtml(env, request, "interest.html");
  return new Response(
    html
      .replaceAll("__TURNSTILE_SITE_KEY__", env.TURNSTILE_SITE_KEY)
      .replaceAll("__SUBMISSION_KEY__", crypto.randomUUID()),
    { headers: { "content-type": "text/html;charset=UTF-8" } },
  );
}

async function submitInterest(request: Request, env: SiteEnv): Promise<Response> {
  if (!interestEnabled(env)) return message("참여 문의는 아직 준비 중입니다.", 503);
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (
    !(await env.RATE_LIMITER.limit({ key: `interest:ip:${ip}` })).success ||
    !(await env.RATE_LIMITER.limit({ key: "interest:global" })).success
  )
    return message(GENERIC_ERROR, 429);
  if (Number(request.headers.get("content-length") ?? "0") > 16_384)
    return message(GENERIC_ERROR, 422);
  let form: FormData;
  try {
    const parsed = await boundedForm(request);
    if (!parsed) return message(GENERIC_ERROR, 422);
    form = parsed;
  } catch (error) {
    if (error instanceof Error) return message(GENERIC_ERROR, 422);
    throw error;
  }
  const email = safeText(form.get("email"), 320)?.toLowerCase() ?? null;
  const displayName = safeText(form.get("displayName"), 80);
  const intent = safeText(form.get("intent"), 1000);
  const rawClue = form.get("knownMemberClue");
  const knownMemberClue = rawClue === "" || rawClue === null ? "" : safeText(rawClue, 200);
  const submissionKey = safeText(form.get("submissionKey"), 120);
  if (
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !displayName ||
    !intent ||
    knownMemberClue === null ||
    !submissionKey ||
    submissionKey.length < 8 ||
    form.get("consent") !== "interest-consent-v1" ||
    form.get("inviteConsent") !== "invite-consent-v1"
  )
    return message(GENERIC_ERROR, 422);
  const shareNameEmailWithIntroducer = form.get("shareNameEmailWithIntroducer") === "yes";
  const turnstile = await verifyTurnstile(
    request,
    env,
    String(form.get("cf-turnstile-response") ?? ""),
    "interest-submit",
  );
  if (turnstile !== "valid") return message(GENERIC_ERROR, turnstile === "invalid" ? 422 : 503);
  try {
    const consentedAt = new Date().toISOString();
    const response = await coreRequest(env, INTEREST_SUBMIT_PATH, {
      submissionKey,
      consentVersion: "interest-consent-v1",
      consentedAt,
      inviteConsentAccepted: true,
      inviteConsentedAt: consentedAt,
      email,
      displayName,
      intent,
      knownMemberClue,
      shareNameEmailWithIntroducer,
    });
    if (response.status !== 202) return message(GENERIC_ERROR, 503);
    const result = await response.json<{ receiptId?: string; withdrawalToken?: string }>();
    if (
      !result.receiptId ||
      !/^INT-[A-Z0-9-]{4,64}$/.test(result.receiptId) ||
      (result.withdrawalToken && !/^[A-Za-z0-9_-]{43}$/.test(result.withdrawalToken))
    )
      return message(GENERIC_ERROR, 503);
    const headers = new Headers({ location: `/receipt/${result.receiptId}` });
    if (result.withdrawalToken && env.SITE_CORE_HMAC_SECRET) {
      const sealed = await sealCapability(
        env.SITE_CORE_HMAC_SECRET,
        result.receiptId,
        result.withdrawalToken,
      );
      headers.set(
        "set-cookie",
        `otl1_interest_withdraw=${sealed}; Path=/receipt/${result.receiptId}; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`,
      );
    }
    return new Response(null, { status: 303, headers });
  } catch (error) {
    if (error instanceof Error) return message(GENERIC_ERROR, 503);
    throw error;
  }
}

async function withdrawInterest(
  request: Request,
  env: SiteEnv,
  receiptId: string,
): Promise<Response> {
  if (!interestEnabled(env)) return message(GENERIC_ERROR, 503);
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (!(await env.RATE_LIMITER.limit({ key: `interest-withdraw:${ip}` })).success)
    return message(GENERIC_ERROR, 429);
  const sealed = request.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)otl1_interest_withdraw=([^;]+)/)?.[1];
  const token =
    sealed && env.SITE_CORE_HMAC_SECRET
      ? await openCapability(env.SITE_CORE_HMAC_SECRET, receiptId, sealed)
      : null;
  if (!token) return message(GENERIC_ERROR, 404);
  try {
    const form = await boundedForm(request);
    const withdrawalKey = form && safeText(form.get("withdrawalKey"), 120);
    if (!withdrawalKey || withdrawalKey.length < 8) return message(GENERIC_ERROR, 422);
    const response = await coreRequest(env, INTEREST_WITHDRAW_PATH, {
      receiptId,
      withdrawalToken: token,
      withdrawalKey,
    });
    if (response.status !== 202) return message(GENERIC_ERROR, 503);
  } catch (error) {
    if (error instanceof Error) return message(GENERIC_ERROR, 503);
    throw error;
  }
  const confirmation = message("철회 요청을 확인했습니다.", 200);
  confirmation.headers.set(
    "set-cookie",
    `otl1_interest_withdraw=; Path=/receipt/${receiptId}; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
  );
  return confirmation;
}

async function withdraw(request: Request, env: SiteEnv, receiptId: string): Promise<Response> {
  if (!(await env.RATE_LIMITER.limit({ key: `withdraw:${receiptId}` })).success)
    return message(GENERIC_ERROR, 429);
  const sealed = request.headers.get("cookie")?.match(/(?:^|;\s*)otl1_withdraw=([^;]+)/)?.[1];
  if (!sealed || !env.SITE_CORE_HMAC_SECRET) return message(GENERIC_ERROR, 404);
  const token = await openCapability(env.SITE_CORE_HMAC_SECRET, receiptId, sealed);
  if (!token) return message(GENERIC_ERROR, 404);
  const form = await request.formData();
  const withdrawalKey = safeText(form.get("withdrawalKey"), 120);
  if (!withdrawalKey || withdrawalKey.length < 8) return message(GENERIC_ERROR, 404);
  try {
    const response = await coreRequest(env, WITHDRAW_PATH, {
      receiptId,
      withdrawalToken: token,
      withdrawalKey,
    });
    if (response.status !== 202) return message(GENERIC_ERROR, 404);
    return new Response(null, {
      status: 303,
      headers: {
        location: `/receipt/${receiptId}?withdrawn=1`,
        "set-cookie": `otl1_withdraw=; Path=/receipt/${receiptId}; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
      },
    });
  } catch (error) {
    if (error instanceof Error) return message(GENERIC_ERROR, 503);
    throw error;
  }
}

const siteWorker = {
  async fetch(request: Request, env: SiteEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname === LEGACY_HOSTNAME) {
      url.protocol = "https:";
      url.hostname = new URL(CANONICAL_ORIGIN).hostname;
      return secured(Response.redirect(url, 308));
    }
    const referral = url.pathname.match(REFERRAL);
    const applyRoute = url.pathname.match(APPLY);
    const receipt = url.pathname.match(RECEIPT);
    const withdrawal = url.pathname.match(WITHDRAW);
    const interestReceipt = url.pathname.match(INTEREST_RECEIPT);
    const interestWithdrawal = url.pathname.match(INTEREST_WITHDRAW);
    const eventSchedule = url.pathname.match(EVENT_SCHEDULE);
    const eventApi = url.pathname.match(EVENT_API);
    let response: Response;
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = await assetHtml(env, request, "index.html");
      response = new Response(
        renderInterestSlots(html, env).replace("<!-- __REFERRAL_SLOT__ -->", ""),
        { headers: { "content-type": "text/html;charset=UTF-8" } },
      );
    } else if (request.method === "GET" && url.pathname === "/po")
      response = await maintainerStatusPage(env);
    else if (request.method === "GET" && url.pathname === "/maintainers")
      response = new Response(null, {
        status: 308,
        headers: { location: new URL("/po", url).toString() },
      });
    else if (
      url.pathname === "/interest.html" ||
      url.pathname === "/receipt.html" ||
      url.pathname === "/referral.html"
    )
      response = message(GENERIC_ERROR, 404);
    else if (request.method === "GET" && url.pathname === "/interest")
      response = await interestPage(request, env);
    else if (request.method === "GET" && eventSchedule)
      response = await eventSchedulePage(request, env, eventSchedule[1]);
    else if (request.method === "POST" && eventApi)
      response = await eventScheduleApi(request, env, eventApi[1]);
    else if (request.method === "POST" && url.pathname === "/interest")
      response = await submitInterest(request, env);
    else if (request.method === "GET" && url.pathname === "/join") {
      const slackInvite = sharedInviteUrl(env.SLACK_SHARED_INVITE_URL);
      response = slackInvite
        ? new Response(null, { status: 303, headers: { location: slackInvite } })
        : message(GENERIC_ERROR, 503);
    } else if (request.method === "GET" && referral)
      response = await referralPage(request, env, referral[1]);
    else if (request.method === "GET" && applyRoute)
      response = Response.redirect(new URL(`/r/${applyRoute[1]}`, request.url), 303);
    else if (request.method === "POST" && applyRoute)
      response = await directJoin(request, env, applyRoute[1]);
    else if (request.method === "GET" && interestReceipt) {
      const html = await assetHtml(env, request, "receipt.html");
      const sealed = request.headers
        .get("cookie")
        ?.match(/(?:^|;\s*)otl1_interest_withdraw=([^;]+)/)?.[1];
      const capability =
        sealed && env.SITE_CORE_HMAC_SECRET
          ? await openCapability(env.SITE_CORE_HMAC_SECRET, interestReceipt[1], sealed)
          : null;
      const receiptBlock = capability
        ? `<p class="receipt-id"><span>영수증</span><strong>${interestReceipt[1]}</strong></p>`
        : "";
      const withdrawForm = capability
        ? `<form action="/receipt/${interestReceipt[1]}/withdraw" method="post"><input type="hidden" name="withdrawalKey" value="${crypto.randomUUID()}"><button class="button button--quiet" type="submit">문의 철회 요청</button></form>`
        : "";
      response = new Response(
        html
          .replaceAll("__RECEIPT_LABEL__", capability ? "문의 접수 기록" : "문의 확인")
          .replaceAll(
            "__STATUS__",
            capability ? "문의가 접수되었습니다." : "접수 여부를 확인할 수 없어요.",
          )
          .replaceAll(
            "__RECEIPT_COPY__",
            capability
              ? "운영자가 문의를 검토합니다. 문의만으로 참여 자격이나 초대가 생기지 않으며, 참여하려면 기존 회원의 확인된 소개와 운영자 승인이 필요합니다."
              : "이 브라우저에서 문의 접수 기록을 확인할 수 없습니다. 이 화면은 문의 상태를 알려주지 않습니다.",
          )
          .replaceAll("__RECEIPT_BLOCK__", receiptBlock)
          .replaceAll("__WITHDRAW_FORM__", withdrawForm),
        { headers: { "content-type": "text/html;charset=UTF-8" } },
      );
    } else if (request.method === "POST" && interestWithdrawal)
      response = await withdrawInterest(request, env, interestWithdrawal[1]);
    else if (request.method === "GET" && receipt) {
      const html = await assetHtml(env, request, "receipt.html");
      const withdrawn = url.searchParams.get("withdrawn") === "1";
      const withdrawForm = withdrawn
        ? ""
        : `<form action="/receipt/${receipt[1]}/withdraw" method="post"><input type="hidden" name="withdrawalKey" value="${crypto.randomUUID()}"><button class="button button--quiet" type="submit">신청 철회</button></form>`;
      response = new Response(
        html
          .replaceAll("__RECEIPT_LABEL__", "신청 영수증")
          .replaceAll(
            "__RECEIPT_BLOCK__",
            `<p class="receipt-id"><span>영수증</span><strong>${receipt[1]}</strong></p>`,
          )
          .replaceAll("__RECEIPT_ID__", receipt[1])
          .replaceAll(
            "__STATUS__",
            withdrawn ? "신청 철회가 접수되었습니다." : "신청이 안전하게 접수되었습니다.",
          )
          .replaceAll(
            "__RECEIPT_COPY__",
            "운영자가 내용을 직접 확인합니다. 승인되면 Slack 초대를 수동으로 보내며, 초대를 수락해야 참여가 확인됩니다.",
          )
          .replaceAll("__WITHDRAW_FORM__", withdrawForm),
        { headers: { "content-type": "text/html;charset=UTF-8" } },
      );
    } else if (request.method === "POST" && withdrawal)
      response = await withdraw(request, env, withdrawal[1]);
    else response = await env.ASSETS.fetch(request);
    return secured(response);
  },
} satisfies ExportedHandler<SiteEnv>;
export default siteWorker;
