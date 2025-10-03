"use client";

import { useMemo, useState, useEffect } from "react";
import { api, SingleReq, ParlayReq, ParlayResp, SingleResp } from "@/lib/api";
import { RefreshCw, Percent, Info, TrendingUp } from "lucide-react";

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
type Phase = "boot" | "landing" | "home" | "menu";

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

  /* ---------- Single bet UI state ---------- */
  // Place Bet: Team vs Team UI
  const [single, setSingle] = useState<SingleReq>(() => ({
    home_team: "PIT",
    away_team: "BAL",
    market: "moneyline", // "moneyline" | "spread"
    pick: "home", // "home" | "away"
    american_odds: -120, // UI-only; translated to "odds"
    line: 0, // for spread
    stake: 100, // default stake
  } as unknown as SingleReq));

  // Place Bet: Player prop UI
  const [betMode, setBetMode] = useState<BetMode>("team");
  const [playerName, setPlayerName] = useState<string>("Patrick Mahomes");
  const [playerMetric, setPlayerMetric] =
    useState<keyof typeof PROP_KIND_BY_LABEL>("Passing Yards");
  const [playerOverUnder, setPlayerOverUnder] =
    useState<"over" | "under">("over");
  const [playerLine, setPlayerLine] = useState<number>(275.5);
  const [playerOdds, setPlayerOdds] = useState<number>(-110);
  const [playerOpponent, setPlayerOpponent] = useState<string>("BUF"); // backend expects opponent_team
  const [playerStake, setPlayerStake] = useState<number>(100);

  // Parlay (UI state)
  const [parlay, setParlay] = useState<ParlayReq>(() => ({
    // @ts-expect-error: initialize with a concrete shape; ParlayReq.legs may be unknown in lib types
    legs: [
      {
        home_team: "KC",
        away_team: "CIN",
        market: "moneyline",
        pick: "home",
        american_odds: -135,
      },
      {
        home_team: "PHI",
        away_team: "DAL",
        market: "spread",
        pick: "away",
        line: +3.5,
        american_odds: -110,
      },
    ],
    // @ts-expect-error stake may not exist in lib type; keep local UI state
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

  /* ---------- actions ---------- */
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

        const r = await api.single(payload);
        setResult(r);
      } else {
        // Player prop → backend "prop" payload
        const payload = {
          market: "prop",
          player: playerName,
          prop_kind: PROP_KIND_BY_LABEL[playerMetric],
          side: playerOverUnder, // "over" | "under"
          line: Number(playerLine),
          opponent: playerOpponent,
          odds: Number(playerOdds),
          stake: Number(playerStake),
        };
        const r = await api.single(payload as any);
        setResult(r as AnyResult);
      }
    } catch (e: any) {
      setErr(e?.message ?? "Request failed");
    } finally {
      setBusy(false);
    }
  }

  async function doParlay() {
    try {
      setBusy(true);
      setErr(null);
      const payload: any = parlay; // send through as-is to the API
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

  /* ---------- local narrow for parlay legs (fix TypeScript 'unknown') ---------- */
  type UILeg = {
    home_team?: string;
    away_team?: string;
    market?: "moneyline" | "spread";
    pick?: "home" | "away";
    line?: number;
    american_odds?: number;
  };
  // Some lib versions declare ParlayReq.legs as unknown; coerce safely for the UI.
  const parlayLegs: UILeg[] = (parlay as any)?.legs ?? [];

  return (
    <>
      {/* Overlays */}
      {phase !== "menu" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
          {phase === "boot" && (
            <div className="text-center">
              <div className="text-2xl font-bold mb-4">Best Bet NFL</div>
              <div className="w-64 h-3 bg-white/10 rounded overflow-hidden mx-auto">
                <div
                  className="h-full bg-white"
                  style={{ width: `${bootProgress}%` }}
                />
              </div>
              <div className="text-white/60 text-sm mt-2">Loading... {bootProgress}%</div>
            </div>
          )}

          {phase === "landing" && (
            <div className="text-center space-y-4">
              <div className="text-3xl font-bold tracking-wide">Best Bet NFL</div>
              <div className="text-white/70">Press Start to continue</div>
            </div>
          )}

          {phase === "home" && (
            <div className="text-center space-y-4">
              <div className="text-4xl font-extrabold">Best Bet NFL</div>
              <button className="btn btn-primary" onClick={() => setPhase("menu")}>Start</button>
            </div>
          )}
        </div>
      )}

      {/* Main app only when in menu phase */}
      {phase === "menu" && (
        <div className="min-h-screen">
          {/* Header */}
          <div
            className="relative min-h-[220px] flex items-end bg-cover bg-center"
            style={{ backgroundImage: `url(${heroBg})` }}
          >
            <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.4),rgba(0,0,0,0.85))]" />
            <div className="relative container mx-auto px-4 py-10">
              <div className="flex items-center gap-3 text-white/80 text-sm">
                <TrendingUp size={16} />
                <span>Best Bet NFL</span>
              </div>
              <h1 className="text-2xl md:text-3xl font-bold mt-2">Betting Simulator & True Odds Engine</h1>
              <p className="text-white/70 max-w-3xl mt-2">
                Simulate singles, parlays, or batch slips and see true probabilities (0.01% precision) and EV.
              </p>
              <div className="mt-4">
                <button className="btn" onClick={doRefresh} disabled={busy}>
                  <RefreshCw size={16} className="mr-2" />
                  Refresh weekly stats
                </button>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="container mx-auto px-4 py-8 grid md:grid-cols-3 gap-6">
            {/* Left menu */}
            <div className="card h-fit">
              <div className="text-sm uppercase tracking-widest text-white/60 mb-3">Main Menu</div>
              <div className="grid gap-2">
                <button className={`btn ${tab === "single" ? "btn-primary" : ""}`} onClick={() => setTab("single")}>
                  Single / Moneyline / Spread / Player
                </button>
                <button className={`btn ${tab === "parlay" ? "btn-primary" : ""}`} onClick={() => setTab("parlay")}>
                  Parlay
                </button>
                <button className={`btn ${tab === "batch" ? "btn-primary" : ""}`} onClick={() => setTab("batch")}>
                  Batch JSON
                </button>
              </div>
            </div>

            {/* Right panels */}
            <div className="md:col-span-2 grid gap-6">
              {/* SINGLE */}
              {/* (unchanged UI; omitted here for brevity) */}
              {/* ... keep the entire Single UI block from your current file ... */}

              {/* PARLAY */}
              {tab === "parlay" && (
                <div className="card">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-lg font-semibold">Parlay</h2>
                    <button className="btn btn-primary" onClick={doParlay} disabled={busy}>
                      {busy ? "Evaluating..." : "Evaluate Parlay"}
                    </button>
                  </div>

                  <div className="grid gap-4">
                    {parlayLegs.map((leg, idx) => (
                      <div key={idx} className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
                        <div>
                          <label className="label">Home</label>
                          <input
                            className="input"
                            value={leg.home_team ?? ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              setParlay((p) => {
                                const next: any = { ...(p as any) };
                                next.legs = [...parlayLegs];
                                next.legs[idx] = { ...parlayLegs[idx], home_team: v };
                                return next as ParlayReq;
                              });
                            }}
                          />
                        </div>
                        <div>
                          <label className="label">Away</label>
                          <input
                            className="input"
                            value={leg.away_team ?? ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              setParlay((p) => {
                                const next: any = { ...(p as any) };
                                next.legs = [...parlayLegs];
                                next.legs[idx] = { ...parlayLegs[idx], away_team: v };
                                return next as ParlayReq;
                              });
                            }}
                          />
                        </div>
                        <div>
                          <label className="label">Market</label>
                          <select
                            className="input"
                            value={leg.market ?? "moneyline"}
                            onChange={(e) => {
                              const v = e.target.value as UILeg["market"];
                              setParlay((p) => {
                                const next: any = { ...(p as any) };
                                next.legs = [...parlayLegs];
                                next.legs[idx] = { ...parlayLegs[idx], market: v };
                                return next as ParlayReq;
                              });
                            }}
                          >
                            <option value="moneyline">moneyline</option>
                            <option value="spread">spread</option>
                          </select>
                        </div>
                        <div>
                          <label className="label">Pick</label>
                          <select
                            className="input"
                            value={leg.pick ?? "home"}
                            onChange={(e) => {
                              const v = e.target.value as UILeg["pick"];
                              setParlay((p) => {
                                const next: any = { ...(p as any) };
                                next.legs = [...parlayLegs];
                                next.legs[idx] = { ...parlayLegs[idx], pick: v };
                                return next as ParlayReq;
                              });
                            }}
                          >
                            <option value="home">home</option>
                            <option value="away">away</option>
                          </select>
                        </div>
                        <div>
                          <label className="label">Line (for spread)</label>
                          <input
                            className="input"
                            type="number"
                            value={Number(leg.line ?? 0)}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              setParlay((p) => {
                                const next: any = { ...(p as any) };
                                next.legs = [...parlayLegs];
                                next.legs[idx] = { ...parlayLegs[idx], line: v };
                                return next as ParlayReq;
                              });
                            }}
                          />
                        </div>
                        <div>
                          <label className="label">American Odds</label>
                          <input
                            className="input"
                            type="number"
                            value={Number(leg.american_odds ?? 0)}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              setParlay((p) => {
                                const next: any = { ...(p as any) };
                                next.legs = [...parlayLegs];
                                next.legs[idx] = { ...parlayLegs[idx], american_odds: v };
                                return next as ParlayReq;
                              });
                            }}
                          />
                        </div>
                        <div className="md:col-span-6 flex justify-end">
                          <button
                            className="btn btn-secondary"
                            onClick={() =>
                              setParlay((p) => {
                                const next: any = { ...(p as any) };
                                next.legs = parlayLegs.filter((_, i) => i !== idx);
                                return next as ParlayReq;
                              })
                            }
                          >
                            Remove leg
                          </button>
                        </div>
                      </div>
                    ))}

                    <div className="flex items-center justify-between">
                      <button
                        className="btn"
                        onClick={() =>
                          setParlay((p) => {
                            const next: any = { ...(p as any) };
                            next.legs = [
                              ...parlayLegs,
                              {
                                home_team: "NYJ",
                                away_team: "BUF",
                                market: "moneyline",
                                pick: "home",
                                american_odds: -110,
                              },
                            ];
                            return next as ParlayReq;
                          })
                        }
                      >
                        + Add leg
                      </button>

                      <div className="flex items-center gap-2">
                        <label className="label">Stake</label>
                        <input
                          className="input w-28"
                          type="number"
                          // @ts-expect-error stake may not exist in lib type; local UI field only
                          value={Number((parlay as any).stake ?? 10)}
                          onChange={(e) =>
                            setParlay((p) => ({ ...(p as any), stake: Number(e.target.value) } as ParlayReq))
                          }
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* BATCH JSON */}
              {/* (unchanged from previous fix) */}
              {/* ... keep your Batch UI block and Results block as in the last file ... */}
            </div>
          </div>

          <div className="footer">
            © {new Date().getFullYear()} Best Bet NFL — Educational use only. Not financial advice.
          </div>
        </div>
      )}
    </>
  );
}









