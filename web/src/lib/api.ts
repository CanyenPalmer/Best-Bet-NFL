const BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "";

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`API ${r.status} ${r.statusText}: ${text}`);
  }
  return r.json();
}

export type SingleReq = {
  market: "prop" | "moneyline" | "spread";
  stake: number;
  odds: number;
  player?: string;
  opponent_team?: string;
  prop_kind?: string;
  side?: "over" | "under";
  line?: number;
  team?: string;
  opponent?: string;
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
  refresh: () => post("/refresh-data", {})
};
