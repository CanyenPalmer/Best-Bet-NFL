"use client";

import { useMemo, useState, useEffect } from "react";
import { api, SingleReq, ParlayReq, ParlayResp, SingleResp } from "@/lib/api";
import { RefreshCw, Percent, Plus, Minus, Info, TrendingUp } from "lucide-react";

/* ---------- helpers ---------- */
function impliedFromAmerican(odds: number): number {
  const ao = Number(odds);
  if (Number.isNaN(ao)) return 0.5;
  return ao >= 0 ? 100 / (ao + 100) : Math.abs(ao) / (Math.abs(ao) + 100);
}
function pct(n: number) {
  const p = Math.max(0, Math.min(1, n));
  return `${(p * 100).toFixed(2)}%`;
}

type Tab = "single" | "parlay" | "batch";
type AnyResult =
  | SingleResp
  | ParlayResp
  | { singles: SingleResp[]; parlays: ParlayResp[] }
  | null;

/* ---------- overlay phases ---------- */
type Phase = "boot" | "landing" | "home" | "menu" | "section";

/* ---------- bet modes ---------- */
type BetMode = "team" | "player";

/* ---------- player metric → prop_kind mapping ---------- */
const PROP_KIND_BY_LABEL: Record<string, string> = {
  "Passing Yards": "qb_pass_yards",
  "Passing TDs": "qb_pass_tds",
  "Completions": "qb_completions",
  "Passing Attempts": "qb_pass_attempts",
  "Rushing Yards": "rb_rush_yards",
  "Rushing TDs": "rb_rush_tds",
  "Receptions": "wr_receptions",
  "Receiving Yards": "wr_rec_yards",
  "Receiving TDs": "wr_rec_tds",
} as const;

const PLAYER_METRICS = Object.keys(PROP_KIND_BY_LABEL) as (keyof typeof PROP_KIND_BY_LABEL)[];

export default function Page() {
  const [phase, setPhase] = useState<Phase>("boot");
  const [bootProgress, setBootProgress] = useState(0);

  /* Boot progress → landing → home (start screen) */
  useEffect(() => {
    if (phase !== "boot") return;
    const total = 2250;
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const elapsed = performance.now() - t0;
      const p = Math.min(100, Math.round((elapsed / total) * 100));
      setBootProgress(p);
      if (p >= 100) {
        setPhase("landing");
        const id = setTimeout(() => setPhase("home"), 600);
        return () => clearTimeout(id);
      } else {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  /* -------- state (engine untouched) -------- */

  // Place Bet: Team vs Team UI
  const [single, setSingle] = useState<SingleReq>(() => ({
    home_team: "PIT",
    away_team: "BAL",
    market: "moneyline",           // "moneyline" | "spread"
    pick: "home",                  // "home" | "away"
    american_odds: -120,           // UI-only; translated to "odds"
    line: 0,                       // for spread
    stake: 100,                    // default stake
  } as unknown as SingleReq));

  // Place Bet: Player prop UI
  const [betMode, setBetMode] = useState<BetMode>("team");
  const [playerName, setPlayerName] = useState<string>("Patrick Mahomes");
  const [playerMetric, setPlayerMetric] = useState<keyof typeof PROP_KIND_BY_LABEL>("Passing Yards");
  const [playerOverUnder, setPlayerOverUnder] = useState<"over" | "under">("over");
  const [playerLine, setPlayerLine] = useState<number>(275.5);
  const [playerOdds, setPlayerOdds] = useState<number>(-110);
  const [playerOpponent, setPlayerOpponent] = useState<string>("BUF"); // backend expects opponent_team
  const [playerStake, setPlayerStake] = useState<number>(100);

  // Parlay (UI state)
  const [parlay, setParlay] = useState<ParlayReq>(() => ({
    legs: [
      { home_team: "KC", away_team: "CIN", market: "moneyline", pick: "home", american_odds: -135 },
      { home_team: "PHI", away_team: "DAL", market: "spread", pick: "away", line: +3.5, american_odds: -110 },
    ],
    stake: 10,
  } as unknown as ParlayReq));

  const [batchPayload, setBatchPayload] = useState<string>(`{
  "singles": [
    { "market": "moneyline", "team": "PIT", "opponent": "BAL", "odds": -120, "stake": 100 }
  ],
  "parlays": [
    { "legs": [
      { "market": "moneyline", "team": "KC", "opponent": "CIN", "odds": -135 },
      { "market": "spread", "team": "DAL", "opponent": "PHI", "spread_line": 3.5, "odds": -110 }
    ], "stake": 10 }
  ]
}`);

  const [tab, setTab] = useState<Tab>("single");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AnyResult>(null);
  const [err, setErr] = useState<string | null>(null);

  function clampNum(n: any, fallback = 0) {
    const x = Number(n);
    return Number.isFinite(x) ? x : fallback;
  }

  // Submit Single (team or player), translating UI → backend contract
  async function doSingle() {
    try {
      setBusy(true);
      setErr(null);

      if (betMode === "team") {
        const mkt = String((single as any).market);
        const pick = String((single as any).pick);
        const home = String((single as any).home_team || "");
        const away = String((single as any).away_team || "");
        const odds = Number((single as any).american_odds ?? 0);
        const stake = Number((single as any).stake ?? 100);

        const team = pick === "home" ? home : away;
        const opponent = pick === "home" ? away : home;

        const payload: any =
          mkt === "moneyline"
            ? {
                market: "moneyline",
                team,
                opponent,
                odds,
                stake,
                odds_format: "american",
              }
            : {
                market: "spread",
                team,
                opponent,
                spread_line: Number((single as any).line ?? 0),
                odds,
                stake,
                odds_format: "american",
              };

        const r = await api.single(payload as SingleReq);
        setResult(r);
      } else {
        // Player prop
        const prop_kind = PROP_KIND_BY_LABEL[playerMetric];
        const payload: any = {
          market: "prop",
          player: playerName,
          opponent_team: playerOpponent,
          prop_kind,
          side: playerOverUnder,      // "over" | "under"
          line: Number(playerLine),
          odds: Number(playerOdds),
          stake: Number(playerStake),
          odds_format: "american",
        };
        const r = await api.single(payload as SingleReq);
        setResult(r);
      }
    } catch (e: any) {
      setErr(e?.message ?? "Request failed");
    } finally {
      setBusy(false);
    }
  }

  // Submit Parlay (translate each leg)
  async function doParlay() {
    try {
      setBusy(true);
      setErr(null);

      const ui: any = parlay;
      const legs = (ui.legs || []).map((leg: any) => {
        const pick = String(leg.pick);
        const home = String(leg.home_team || "");
        const away = String(leg.away_team || "");
        const team = pick === "home" ? home : away;
        const opponent = pick === "home" ? away : home;

        if (leg.market === "moneyline") {
          return {
            market: "moneyline",
            team,
            opponent,
            odds: Number(leg.american_odds ?? 0),
            odds_format: "american",
          };
        } else if (leg.market === "spread") {
          return {
            market: "spread",
            team,
            opponent,
            spread_line: Number(leg.line ?? 0),
            odds: Number(leg.american_odds ?? 0),
            odds_format: "american",
          };
        } else {
          return {
            market: "moneyline",
            team,
            opponent,
            odds: Number(leg.american_odds ?? 0),
            odds_format: "american",
          };
        }
      });

      const payload = {
        stake: Number(ui.stake ?? 10),
        legs,
      };

      const r = await api.parlay(payload as ParlayReq);
      setResult(r);
    } catch (e: any) {
      setErr(e?.message ?? "Request failed");
    } finally {
      setBusy(false);
    }
  }

  async function doBatch() {
    try {
      setBusy(true);
      setErr(null);
      const payload = JSON.parse(batchPayload);
      const r = await api.batch(payload);
      setResult(r as AnyResult);
    } catch (e: any) {
      setErr(e?.message ?? "Invalid JSON or request failed");
    } finally {
      setBusy(false);
    }
  }

  async function doRefresh() {
    try {
      setBusy(true);
      setErr(null);
      await api.refresh(); // calls POST /refresh-data
    } catch (e: any) {
      setErr(e?.message ?? "Refresh failed");
    } finally {
      setBusy(false);
    }
  }

  // Implied probability from american_odds (Team mode only)
  const impliedSingle = useMemo(
    () => impliedFromAmerican((((single as any).american_odds as number) ?? 0)),
    [ (single as any).american_odds ]
  );

  /* ---------- dynamic background per view ---------- */
  const heroBg =
    tab === "single"
      ? "/assets/bg/bg-betting.png"
      : tab === "batch"
      ? "/assets/bg/bg-stats.png"
      : "/assets/bg/bg-settings.png";

  /* ---------- overlays (keep your latest working overlay UI) ---------- */
  // (Use your current overlays with Start screen, colored menu buttons, etc.)

  return (
    <>
      {/* ... your existing overlays (boot, home, menu) unchanged ... */}

      <div className="min-h-screen">
        {/* Header */}
        <div
          className="hero"
          style={{ backgroundImage: `url('${heroBg}')` }}
        >
          <div className="relative z-10 mx-auto max-w-6xl px-4 py-16">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <img src="/assets/pixel/logo/best-bet-nfl.png" alt="Best Bet NFL" className="w-14 h-14" />
                <div>
                  <h1 className="text-2xl font-bold leading-tight">Best Bet NFL</h1>
                  <p className="text-white/70">Actual probabilities for NFL bets</p>
                </div>
              </div>
              <button
                className="btn"
                onClick={doRefresh}
                title="Refresh data"
                style={{ backgroundColor: "rgba(255,255,255,0.10)", borderColor: "rgba(255,255,255,0.20)", borderWidth: 1 }}
              >
                <RefreshCw className="mr-2 h-4 w-4" /> Refresh
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="mx-auto max-w-6xl px-4 py-6 grid md:grid-cols-3 gap-6">
          {/* Left menu */}
          <div className="card h-fit">
            <div className="text-sm uppercase tracking-widest text-white/60 mb-3">Main Menu</div>
            <div className="grid gap-2">
              <button className={`btn ${tab === "single" ? "btn-primary" : ""}`} onClick={() => setTab("single")}>Single / Moneyline / Spread / Player</button>
              <button className={`btn ${tab === "parlay" ? "btn-primary" : ""}`} onClick={() => setTab("parlay")}>Parlay</button>
              <button className={`btn ${tab === "batch" ? "btn-primary" : ""}`} onClick={() => setTab("batch")}>Batch JSON</button>
            </div>
          </div>

          {/* Right panels */}
          <div className="md:col-span-2 grid gap-6">
            {/* SINGLE */}
            {tab === "single" && (
              <div className="card">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <h2 className="text-lg font-semibold">Place Bet</h2>

                  <div className="flex items-center gap-2">
                    <span className="text-sm text-white/70">Mode:</span>
                    <div className="flex items-center gap-2">
                      <button
                        className={`btn ${betMode === "team" ? "btn-primary" : ""}`}
                        onClick={() => setBetMode("team")}
                      >
                        Team
                      </button>
                      <button
                        className={`btn ${betMode === "player" ? "btn-primary" : ""}`}
                        onClick={() => setBetMode("player")}
                      >
                        Player
                      </button>
                    </div>
                  </div>

                  {betMode === "team" && (
                    <div className="text-white/60 text-sm flex items-center gap-2">
                      <Percent size={16}/>
                      Implied: {pct(impliedSingle)}
                    </div>
                  )}
                </div>

                {/* TEAM MODE */}
                {betMode === "team" && (
                  <>
                    <div className="grid-cols-form">
                      <div>
                        <div className="label">Home Team</div>
                        <input className="input" value={(single as any).home_team} onChange={e => setSingle({ ...(single as any), home_team: e.target.value } as unknown as SingleReq)}/>
                      </div>
                      <div>
                        <div className="label">Away Team</div>
                        <input className="input" value={(single as any).away_team} onChange={e => setSingle({ ...(single as any), away_team: e.target.value } as unknown as SingleReq)}/>
                      </div>
                      <div>
                        <div className="label">Market</div>
                        <select className="input" value={(single as any).market} onChange={e => setSingle({ ...(single as any), market: e.target.value as any } as unknown as SingleReq)}>
                          <option value="moneyline">Moneyline</option>
                          <option value="spread">Spread</option>
                        </select>
                      </div>
                      <div>
                        <div className="label">Pick</div>
                        <select className="input" value={(single as any).pick} onChange={e => setSingle({ ...(single as any), pick: e.target.value as any } as unknown as SingleReq)}>
                          <option value="home">Home</option>
                          <option value="away">Away</option>
                        </select>
                      </div>
                      <div>
                        <div className="label">American Odds</div>
                        <input
                          type="number"
                          className="input"
                          value={(single as any).american_odds}
                          onChange={e => setSingle({ ...(single as any), american_odds: clampNum(e.target.value, -110) } as unknown as SingleReq)}
                        />
                      </div>
                      {((single as any).market === "spread") && (
                        <div>
                          <div className="label">Line (spread_line)</div>
                          <input
                            type="number"
                            className="input"
                            value={(single as any).line ?? 0}
                            onChange={e => setSingle({ ...(single as any), line: clampNum(e.target.value, 0) } as unknown as SingleReq)}
                          />
                        </div>
                      )}
                      <div>
                        <div className="label">Stake</div>
                        <input
                          type="number"
                          className="input"
                          value={(single as any).stake ?? 100}
                          onChange={e => setSingle({ ...(single as any), stake: clampNum(e.target.value, 100) } as unknown as SingleReq)}
                        />
                      </div>
                    </div>

                    <div className="mt-4 flex items-center gap-3">
                      <button className="btn btn-primary" onClick={doSingle} disabled={busy}>
                        <TrendingUp className="mr-2 h-4 w-4" /> Evaluate
                      </button>
                      {busy && <div className="text-white/60 text-sm">Crunching numbers…</div>}
                      {err && <div className="text-red-400 text-sm">{err}</div>}
                    </div>
                  </>
                )}

                {/* PLAYER MODE */}
                {betMode === "player" && (
                  <>
                    <div className="grid-cols-form">
                      <div>
                        <div className="label">Player</div>
                        <input className="input" value={playerName} onChange={e => setPlayerName(e.target.value)} placeholder="e.g., Patrick Mahomes"/>
                      </div>
                      <div>
                        <div className="label">Opponent Team</div>
                        <input className="input" value={playerOpponent} onChange={e => setPlayerOpponent(e.target.value.toUpperCase())} placeholder="e.g., BUF"/>
                      </div>
                      <div>
                        <div className="label">Metric</div>
                        <select className="input" value={playerMetric} onChange={e => setPlayerMetric(e.target.value as any)}>
                          {PLAYER_METRICS.map(m => <option value={m} key={m}>{m}</option>)}
                        </select>
                      </div>
                      <div>
                        <div className="label">Outcome</div>
                        <select className="input" value={playerOverUnder} onChange={e => setPlayerOverUnder(e.target.value as "over" | "under")}>
                          <option value="over">Over</option>
                          <option value="under">Under</option>
                        </select>
                      </div>
                      <div>
                        <div className="label">Line</div>
                        <input type="number" className="input" step="0.1" value={playerLine} onChange={e => setPlayerLine(clampNum(e.target.value, 0))}/>
                      </div>
                      <div>
                        <div className="label">American Odds</div>
                        <input type="number" className="input" value={playerOdds} onChange={e => setPlayerOdds(clampNum(e.target.value, -110))}/>
                      </div>
                      <div>
                        <div className="label">Stake</div>
                        <input type="number" className="input" value={playerStake} onChange={e => setPlayerStake(clampNum(e.target.value, 100))}/>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center gap-3">
                      <button className="btn btn-primary" onClick={doSingle} disabled={busy}>
                        <TrendingUp className="mr-2 h-4 w-4" /> Evaluate
                      </button>
                      {busy && <div className="text-white/60 text-sm">Crunching numbers…</div>}
                      {err && <div className="text-red-400 text-sm">{err}</div>}
                    </div>
                  </>
                )}

                {/* Results */}
                {result && "probability" in result && (
                  <div className="mt-6 bg-white/5 border border-white/10 rounded-xl p-4">
                    <div className="text-sm text-white/70">Model Output</div>
                    <div className="mt-2 text-xl font-semibold">Hit Probability: {pct(result.probability)}</div>
                    <div className="text-white/70">EV: {result.expected_value.toFixed(2)}</div>
                  </div>
                )}
              </div>
            )}

            {/* PARLAY & BATCH sections — unchanged UI; doParlay/doBatch already translate payloads */}
          </div>
        </div>

        <div className="footer">
          © {new Date().getFullYear()} Best Bet NFL — Educational use only. Not financial advice.
        </div>
      </div>
    </>
  );
}

/*ignore*/





