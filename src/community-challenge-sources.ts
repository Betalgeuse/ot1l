export type ChallengeTrack = "dev" | "math";
export type SourcedChallenge = {
  id: string;
  title: string;
  publisher: string;
  url: string;
  solutionUrl: string;
  solutionLabel: string;
};

function plain(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function allowedChallengeUrl(value: string): boolean {
  try {
    const u = new URL(value);
    if (
      u.protocol !== "https:" ||
      u.port ||
      u.username ||
      u.password ||
      u.hash ||
      /[<>|\s]/.test(value)
    )
      return false;
    if (u.search && !(u.hostname === "atcoder.jp" && u.search === "?lang=en")) return false;
    return (
      (u.hostname === "atcoder.jp" &&
        /^\/contests\/abc\d+\/(tasks\/abc\d+_[bc](\/editorial)?|editorial)$/.test(u.pathname)) ||
      (u.hostname === "mensa.org.uk" && /^\/puzzle\/(?:[a-z0-9-]+\/)?$/.test(u.pathname))
    );
  } catch {
    return false;
  }
}

async function page(url: string, request: typeof fetch): Promise<string> {
  const u = new URL(url);
  if (
    !allowedChallengeUrl(url) &&
    !(u.origin === "https://mensa.org.uk" && /^\/puzzle\/page\/[1-4]\/$/.test(u.pathname))
  )
    throw new Error("challenge_source_url_denied");
  const response = await request(url, { signal: AbortSignal.timeout(8000), redirect: "manual" });
  if (!response.ok || !response.headers.get("content-type")?.includes("text/html"))
    throw new Error("challenge_source_unavailable");
  if (Number(response.headers.get("content-length") ?? 0) > 1_000_000)
    throw new Error("challenge_source_too_large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("challenge_source_empty");
  const decoder = new TextDecoder();
  let result = "",
    bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > 1_000_000) throw new Error("challenge_source_too_large");
      result += decoder.decode(chunk.value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    await reader.cancel();
  }
}

export function atCoderSource(html: string, contest: number, letter: "b" | "c"): SourcedChallenge {
  const title = plain(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  if (
    !title.startsWith(`${letter.toUpperCase()} - `) ||
    !html.includes("Problem Statement") ||
    !html.includes("Sample Input")
  )
    throw new Error("atcoder_problem_not_verified");
  const path = `/contests/abc${contest}/tasks/abc${contest}_${letter}`;
  const editorial = [...html.matchAll(/href="([^"]*editorial[^"]*)"/g)]
    .map((m) => m[1])
    .find((href) => href === `${path}/editorial`);
  if (!editorial) throw new Error("atcoder_editorial_missing");
  return {
    id: `atcoder-abc${contest}-${letter}`,
    title: `ABC ${contest} · ${title}`,
    publisher: "AtCoder",
    url: `https://atcoder.jp${path}?lang=en`,
    solutionUrl: `https://atcoder.jp${editorial}?lang=en`,
    solutionLabel: "공식 해설 보기",
  };
}

export function mensaCandidates(html: string, day: string): SourcedChallenge[] {
  const candidates: SourcedChallenge[] = [];
  for (const match of html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)) {
    const article = match[1] ?? "";
    const link = article.match(/<h3\b[^>]*>[\s\S]*?<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const preview = plain(
      article.match(/class="elementor-post__excerpt"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "",
    );
    if (!link?.[1] || !allowedChallengeUrl(link[1]) || new URL(link[1]).hostname !== "mensa.org.uk")
      continue;
    const title = plain(link[2] ?? "");
    const date = title.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})\b/);
    if (!date) continue;
    const published = `20${date[3]}-${date[2]?.padStart(2, "0")}-${date[1]?.padStart(2, "0")}`;
    if (published > day) continue;
    // Avoid English vocabulary/anagram exercises in the math chapter.
    if (/word|letter|alphabet|proverb|anagram|quote/i.test(preview)) continue;
    if (
      !/number|clock|cars|vehicles|train|coins|pocket|how many|grid|square|triangle|safe|calculate|eight members|cycling/i.test(
        preview,
      )
    )
      continue;
    candidates.push({
      id: `mensa-${new URL(link[1]).pathname.split("/").filter(Boolean).at(-1)}`,
      title: `British Mensa · ${title}`,
      publisher: "British Mensa",
      url: link[1],
      solutionUrl: link[1],
      solutionLabel: "원문에서 Show Answer 열기",
    });
  }
  return [...new Map(candidates.map((c) => [c.id, c])).values()];
}

export async function sourceChallenge(
  track: ChallengeTrack,
  index: number,
  day: string,
  reserve: (source: SourcedChallenge) => Promise<boolean>,
  request: typeof fetch = fetch,
): Promise<SourcedChallenge> {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error("invalid_challenge_index");
  if (track === "dev") {
    // Ended ABC archives, B/C alternating. Never wrap back to old problems.
    const contest = 260 + Math.floor(index / 2),
      letter = index % 2 ? "c" : "b";
    const url = `https://atcoder.jp/contests/abc${contest}/tasks/abc${contest}_${letter}?lang=en`;
    const html = await page(url, request);
    const dates = [...html.matchAll(/<time\b[^>]*>([^<]+)<\/time>/g)].map((m) =>
      Date.parse(m[1] ?? ""),
    );
    // The page must explicitly show a contest end in the past; no active contests.
    if (
      dates.length < 2 ||
      !Number.isFinite(dates[1]) ||
      (dates[1] ?? Infinity) >= Date.parse(`${day}T00:00:00+09:00`)
    )
      throw new Error("atcoder_contest_not_ended");
    const source = atCoderSource(html, contest, letter);
    const editorial = await page(source.solutionUrl, request);
    if (!/>Official<\/span>/.test(editorial) || !editorial.includes(">Editorial</a>"))
      throw new Error("atcoder_official_editorial_missing");
    if (!(await reserve(source))) throw new Error("challenge_source_already_used");
    return source;
  }
  for (let p = 1; p <= 4; p++) {
    const html = await page(
      p === 1 ? "https://mensa.org.uk/puzzle/" : `https://mensa.org.uk/puzzle/page/${p}/`,
      request,
    );
    for (const source of mensaCandidates(html, day)) {
      // Reserve callback performs a persisted date binding. A repeat day can recover.
      if (!(await reserve(source))) continue;
      const detail = await page(source.url, request);
      if (!detail.includes("Show Answer") || !/ee-toggle-element__element\b/.test(detail))
        throw new Error("mensa_answer_missing");
      return source;
    }
  }
  throw new Error("challenge_source_pool_empty");
}

const slackText = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
export function sourcedChallengePayload(
  track: ChallengeTrack,
  date: string,
  source: SourcedChallenge,
) {
  if (!allowedChallengeUrl(source.url) || !allowedChallengeUrl(source.solutionUrl))
    throw new Error("challenge_source_url_denied");
  const label = track === "dev" ? "오늘의 코딩 테스트" : "오늘의 멘사 퍼즐";
  return {
    sourceId: source.id,
    sourceUrl: source.url,
    publisher: source.publisher,
    text: `${date} · ${label}\n*${slackText(source.title)}*\n출처: ${slackText(source.publisher)}\n\n<${source.url}|문제 원문 열기>\n\n${track === "dev" ? "풀이 언어는 자유예요. 원문에서 조건·입출력 예시를 확인하고 풀이와 복잡도를 스레드에 나눠주세요." : "원문에서 문제를 보고 추론 과정을 이 스레드에 나눠주세요."}\n오후 6시에 같은 스레드에서 ${track === "dev" ? "공식 해설" : "정답 확인"} 링크를 안내해요.`,
    solution: `*${slackText(source.title)} · 같이 풀이를 돌아봐요*\n<${source.solutionUrl}|${source.solutionLabel}>\n\n어떤 단서나 접근이 핵심이었나요? 다른 풀이도 이 스레드에서 나눠주세요.`,
  };
}
