import { koreaDate } from "./input";
import type { NeonStore } from "./store";
import { StoreError } from "./store-types";

const WEEKS = 12;
const DAY_MS = 86_400_000;

type QueryStore = Pick<NeonStore, "queryJson">;

const QUERY = `SELECT coalesce(jsonb_agg(jsonb_build_object('w', w, 'n', n)), '[]'::jsonb)::text
FROM (
  SELECT date_trunc('week', day)::date::text AS w, count(DISTINCT user_id) AS n
  FROM otl.community_days
  WHERE team_id = $1 AND day BETWEEN $2::date AND $3::date
    AND (btrim(goal) <> '' OR btrim(reflection) <> '')
  GROUP BY 1
) s`;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function mondayOf(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

export async function handleWeeklyRecorders(
  request: Request,
  teamId: string,
  db: QueryStore,
  nowSeconds: number,
): Promise<Response> {
  if (request.method !== "GET")
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET" } });
  const today = koreaDate(nowSeconds);
  const thisWeek = mondayOf(today);
  const starts = Array.from({ length: WEEKS }, (_, i) => addDays(thisWeek, (i - WEEKS + 1) * 7));
  const rows = await db.queryJson(QUERY, [teamId, starts[0] as string, today]);
  if (!Array.isArray(rows)) throw new StoreError("response");
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (typeof row !== "object" || row === null || Array.isArray(row))
      throw new StoreError("response");
    const { w, n } = row;
    if (typeof w !== "string" || typeof n !== "number") throw new StoreError("response");
    counts.set(w, n);
  }
  return Response.json(
    {
      metric: "weekly_distinct_recorders",
      timezone: "Asia/Seoul",
      weeks: starts.map((week) => ({ week_start: week, recorders: counts.get(week) ?? 0 })),
    },
    { headers: { "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } },
  );
}
