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

  /* ---------- Single bet UI state ---------- */
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
      const payload: ParlayReq = parlay;
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
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="grid gap-2">
                        <label className="label">Home Team</label>
                        <input
                          className="input"
                          value={(single as any).home_team ?? ""}
                          onChange={(e) => setSingle({ ...(single as any), home_team: e.target.value } as any)}
                        />
                      </div>
                      <div className="grid gap-2">
                        <label className="label">Away Team</label>
                        <input
                          className="input"
                          value={(single as any).away_team ?? ""}
                          onChange={(e) => setSingle({ ...(single as any), away_team: e.target.value } as any)}
                        />
                      </div>

                      <div className="grid gap-2">
                        <label className="label">Market</label>
                        <select
                          className="input"
                          value={(single as any).market}
                          onChange={(e) => setSingle({ ...(single as any), market: e.target.value } as any)}
                        >
                          <option value="moneyline">moneyline</option>
                          <option value="spread">spread</option>
                        </select>
                      </div>

                      <div className="grid gap-2">
                        <label className="label">Pick</label>
                        <select
                          className="input"
                          value={(single as any).pick}
                          onChange={(e) => setSingle({ ...(single as any), pick: e.target.value } as any)}
                        >
                          <option value="home">home</option>
                          <option value="away">away</option>
                        </select>
                      </div>

                      {(single as any).market === "spread" && (
                        <div className="grid gap-2">
                          <label className="label">Spread Line</label>
                          <input
                            className="input"
                            type="number"
                            value={clampNum((single as any).line, 0)}
                            onChange={(e) => setSingle({ ...(single as any), line: Number(e.target.value) } as any)}
                          />
                        </div>
                      )}

                      <div className="grid gap-2">
                        <label className="label">American Odds</label>
                        <input
                          className="input"
                          type="number"
                          value={clampNum((single as any).american_odds, 0)}
                          onChange={(e) => setSingle({ ...(single as any), american_odds: Number(e.target.value) } as any)}
                        />
                      </div>

                      <div className="grid gap-2">
                        <label className="label">Stake</label>
                        <input
                          className="input"
                          type="number"
                          value={clampNum((single as any).stake, 100)}
                          onChange={(e) => setSingle({ ...(single as any), stake: Number(e.target.value) } as any)}
                        />
                      </div>
                    </div>
                  )}

                  {/* PLAYER MODE */}
                  {betMode === "player" && (
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="grid gap-2">
                        <label className="label">Player</label>
                        <input
                          className="input"
                          value={playerName}
                          onChange={(e) => setPlayerName(e.target.value)}
                        />
                      </div>

                      <div className="grid gap-2">
                        <label className="label">Metric</label>
                        <select
                          className="input"
                          value={playerMetric}
                          onChange={(e) => setPlayerMetric(e.target.value as any)}
                        >
                          {PLAYER_METRICS.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>

                      <div className="grid gap-2">
                        <label className="label">Side</label>
                        <select
                          className="input"
                          value={playerOverUnder}
                          onChange={(e) => setPlayerOverUnder(e.target.value as any)}
                        >
                          <option value="over">over</option>
                          <option value="under">under</option>
                        </select>
                      </div>

                      <div className="grid gap-2">
                        <label className="label">Line</label>
                        <input
                          className="input"
                          type="number"
                          value={playerLine}
                          onChange={(e) => setPlayerLine(Number(e.target.value))}
                        />
                      </div>

                      <div className="grid gap-2">
                        <label className="label">Opponent (abbr)</label>
                        <input
                          className="input"
                          value={playerOpponent}
                          onChange={(e) => setPlayerOpponent(e.target.value)}
                        />
                      </div>

                      <div className="grid gap-2">
                        <label className="label">American Odds</label>
                        <input
                          className="input"
                          type="number"
                          value={playerOdds}
                          onChange={(e) => setPlayerOdds(Number(e.target.value))}
                        />
                      </div>

                      <div className="grid gap-2">
                        <label className="label">Stake</label>
                        <input
                          className="input"
                          type="number"
                          value={playerStake}
                          onChange={(e) => setPlayerStake(Number(e.target.value))}
                        />
                      </div>
                    </div>
                  )}

                  <div className="mt-6 flex justify-end">
                    <button className="btn btn-primary" onClick={doSingle} disabled={busy}>
                      {busy ? "Evaluating..." : "Evaluate"}
                    </button>
                  </div>
                </div>
              )}

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
                    {parlay.legs.map((leg, idx) => (
                      <div key={idx} className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
                        <div>
                          <label className="label">Home</label>
                          <input
                            className="input"
                            value={(leg as any).home_team ?? ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              setParlay((p) => {
                                const copy = { ...p, legs: p.legs.map((l, i) => (i === idx ? { ...l, home_team: v } : l)) };
                                return copy as any;
                              });
                            }}
                          />
                        </div>
                        <div>
                          <label className="label">Away</label>
                          <input
                            className="input"
                            value={(leg as any).away_team ?? ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              setParlay((p) => {
                                const copy = { ...p, legs: p.legs.map((l, i) => (i === idx ? { ...l, away_team: v } : l)) };
                                return copy as any;
                              });
                            }}
                          />
                        </div>
                        <div>
                          <label className="label">Market</label>
                          <select
                            className="input"
                            value={(leg as any).market ?? "moneyline"}
                            onChange={(e) => {
                              const v = e.target.value as any;
                              setParlay((p) => {
                                const copy = { ...p, legs: p.legs.map((l, i) => (i === idx ? { ...l, market: v } : l)) };
                                return copy as any;
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
                            value={(leg as any).pick ?? "home"}
                            onChange={(e) => {
                              const v = e.target.value as any;
                              setParlay((p) => {
                                const copy = { ...p, legs: p.legs.map((l, i) => (i === idx ? { ...l, pick: v } : l)) };
                                return copy as any;
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
                            value={Number((leg as any).line ?? 0)}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              setParlay((p) => {
                                const copy = { ...p, legs: p.legs.map((l, i) => (i === idx ? { ...l, line: v } : l)) };
                                return copy as any;
                              });
                            }}
                          />
                        </div>
                        <div>
                          <label className="label">American Odds</label>
                          <input
                            className="input"
                            type="number"
                            value={Number((leg as any).american_odds ?? 0)}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              setParlay((p) => {
                                const copy = { ...p, legs: p.legs.map((l, i) => (i === idx ? { ...l, american_odds: v } : l)) };
                                return copy as any;
                              });
                            }}
                          />
                        </div>
                        <div className="md:col-span-6 flex justify-end">
                          <button
                            className="btn btn-secondary"
                            onClick={() =>
                              setParlay((p) => ({ ...p, legs: p.legs.filter((_, i) => i !== idx) } as any))
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
                          setParlay((p) => ({
                            ...p,
                            legs: [
                              ...p.legs,
                              { home_team: "NYJ", away_team: "BUF", market: "moneyline", pick: "home", american_odds: -110 } as any,
                            ],
                          } as any))
                        }
                      >
                        + Add leg
                      </button>

                      <div className="flex items-center gap-2">
                        <label className="label">Stake</label>
                        <input
                          className="input w-28"
                          type="number"
                          value={Number((parlay as any).stake ?? 10)}
                          onChange={(e) => setParlay((p) => ({ ...p, stake: Number(e.target.value) } as any))}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* BATCH JSON */}
              {tab === "batch" && (
                <div className="card">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-lg font-semibold">Batch JSON</h2>
                    <button className="btn btn-primary" onClick={doBatch} disabled={busy}>
                      {busy ? "Evaluating..." : "Evaluate Batch"}
                    </button>
                  </div>

                  <textarea
                    className="input min-h-[240px] font-mono"
                    value={batchPayload}
                    onChange={(e) => setBatchPayload(e.target.value)}
                  />

                  <div className="text-xs text-white/60 mt-2">
                    Tip: Provide keys <code>singles</code> and <code>parlays</code>. See <code>/examples/sample_batch.json</code>.
                  </div>
                </div>
              )}

              {/* RESULTS */}
              <div className="card">
                <div className="flex items-center gap-2 mb-3">
                  <Info size={16} />
                  <h2 className="text-lg font-semibold">Result</h2>
                </div>
                <pre className="bg-black/50 p-3 rounded overflow-auto text-sm">
                  {err ? `Error: ${err}` : JSON.stringify(result, null, 2)}
                </pre>
              </div>
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








