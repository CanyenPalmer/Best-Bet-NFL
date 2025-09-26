// web/src/lib/api.ts
const RAW_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "").trim();
// Normalize: remove trailing slash if present
const BASE = RAW_BASE.endsWith("/") ? RAW_BASE.slice(0, -1) : RAW_BASE;

function url(path: string) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${BASE}${p}`;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const endpoint = url(path);
  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // mode: "cors"  // default in browsers, but explicit is fine if you prefer
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`API ${r.status} ${r.statusText} @ ${endpoint}\n${text}`);
    }
    return r.json();
  } catch (e: any) {
    // Make network/CORS errors obvious
    const m = e?.message || String(e);
    throw new Error(`Failed to reach API @ ${endpoint}\n${m}`);
  }
}

export type SingleReq = {
  market: "prop" | "moneyline" | "spread";
  stake: number;
  odds: number;
  // prop
  player?: string;
  opponent_team?: string;
  prop_kind?: string;
  side?: "over" | "under";
  line?: number;
  // team
  team?: string;
  opponent?: string;
  // spread
  spread_line?: number;
};

export type SingleResp = {
  label: string;
  probability: number;
  probability_pct: string;
  payout_if_win: number;
  expected_value: number;
  summary: string;
  debug: Record<string, unknown>;
  odds?: number;
};

export type ParlayReq = { stake: number; legs: SingleReq[]; };

export type ParlayResp = {
  stake: number;
  legs: { label: string; probability: number; probability_pct: string; odds: number }[];
  parlay_probability_independent_pct: string;
  payout_if_win: number;
  expected_value: number;
  combined_decimal_odds: number;
};

export const api = {
  single: (req: SingleReq) => post<SingleResp>("/evaluate/single", req),
  parlay: (req: ParlayReq) => post<ParlayResp>("/evaluate/parlay", req),
  batch: (payload: unknown) => post("/evaluate/batch", payload),
  refresh: () => post("/refresh-data", {}),
};

