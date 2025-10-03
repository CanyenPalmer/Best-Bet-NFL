// Minimal, safe client for your backend.
// IMPORTANT: Set NEXT_PUBLIC_API_BASE in Vercel to your backend origin, e.g.
// https://best-bet-nfl-backend.onrender.com
const API_BASE =
  (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/+$/, "") || "";

type Json = Record<string, any>;

async function post<T>(path: string, body: Json): Promise<T> {
  if (!API_BASE) {
    throw new Error(
      "API base URL is not set. Define NEXT_PUBLIC_API_BASE in your environment."
    );
  }
  const url = `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status} @ ${path}${text ? ` — ${text}` : ""}`);
  }
  return (await res.json()) as T;
}

async function postNoBody<T>(path: string): Promise<T> {
  if (!API_BASE) {
    throw new Error(
      "API base URL is not set. Define NEXT_PUBLIC_API_BASE in your environment."
    );
  }
  const url = `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status} @ ${path}${text ? ` — ${text}` : ""}`);
  }
  return (await res.json()) as T;
}

/** Types coming from your backend — keep as-is (runtime uses "any" where needed) */
export type SingleReq = Record<string, unknown>;
export type SingleResp = {
  probability: number;
  expected_value: number;
};
export type ParlayReq = Record<string, unknown>;
export type ParlayResp = {
  parlay_probability_independent_pct: string;
  expected_value: number;
  payout_if_win: number;
};

export const api = {
  async single(payload: SingleReq): Promise<SingleResp> {
    return await post<SingleResp>("/evaluate/single", payload as Json);
  },
  async parlay(payload: ParlayReq): Promise<ParlayResp> {
    return await post<ParlayResp>("/evaluate/parlay", payload as Json);
  },
  async batch(payload: Json): Promise<{
    singles: SingleResp[];
    parlays: ParlayResp[];
  }> {
    return await post("/evaluate/batch", payload);
  },
  /** Your backend's refresh route is POST /refresh-data */
  async refresh(): Promise<{ ok: boolean } & Record<string, any>> {
    return await postNoBody("/refresh-data");
  },
};

/* ---------------- Suggestions (added) ----------------
   These map to new GET routes on your backend:
   - /lists/players?prefix=...
   - /lists/teams?prefix=...
   - /lists/prop-kinds
   Safe additions that do not affect existing calls.
*/
export const suggest = {
  async players(prefix: string, limit: number = 50): Promise<string[]> {
    if (!API_BASE) return [];
    const url = `${API_BASE}/lists/players?prefix=${encodeURIComponent(
      prefix ?? ""
    )}&limit=${limit}`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json?.players) ? json.players : [];
  },

  async teams(prefix: string, limit: number = 50): Promise<string[]> {
    if (!API_BASE) return [];
    const url = `${API_BASE}/lists/teams?prefix=${encodeURIComponent(
      prefix ?? ""
    )}&limit=${limit}`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json?.teams) ? json.teams : [];
  },

  async propKinds(): Promise<string[]> {
    if (!API_BASE) return [];
    const url = `${API_BASE}/lists/prop-kinds`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json?.prop_kinds) ? json.prop_kinds : [];
  },
};





