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

/* ---------- new: bet mode inside Place Bet ---------- */
type BetMode = "team" | "player";

/* ---------- player prop helpers ---------- */
const PLAYER_METRICS = [
  "Passing Yards",
  "Passing TDs",
  "Rushing Yards",
  "Rushing TDs",
  "Receptions",
  "Receiving Yards",
  "Receiving TDs",
  "Completions",
  "Tackles",
] as const;
type PlayerMetric = (typeof PLAYER_METRICS)[number];

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

  // Place Bet: Team vs Team
  const [single, setSingle] = useState<SingleReq>(() => ({
    home_team: "PIT",
    away_team: "BAL",
    market: "moneyline",
    pick: "home",
    american_odds: -120,
  } as unknown as SingleReq));

  // Place Bet: Player prop
  const [betMode, setBetMode] = useState<BetMode>("team");
  const [playerName, setPlayerName] = useState<string>("Patrick Mahomes");
  const [playerMetric, setPlayerMetric] = useState<PlayerMetric>("Passing Yards");
  const [playerOverUnder, setPlayerOverUnder] = useState<"over" | "under">("over");
  const [playerLine, setPlayerLine] = useState<number>(275.5);
  const [playerOdds, setPlayerOdds] = useState<number>(-110);

  // Parlay (unchanged)
  const [parlay, setParlay] = useState<ParlayReq>(() => ({
    legs: [
      { home_team: "KC", away_team: "CIN", market: "moneyline", pick: "home", american_odds: -135 },
      { home_team: "PHI", away_team: "DAL", market: "spread", pick: "away", line: +3.5, american_odds: -110 },
    ],
    stake: 10,
  } as unknown as ParlayReq));

  const [batchPayload, setBatchPayload] = useState<string>(`{
  "singles": [
    { "home_team": "PIT", "away_team": "BAL", "market": "moneyline", "pick": "home", "american_odds": -120 }
  ],
  "parlays": [
    { "legs": [
      { "home_team": "KC", "away_team": "CIN", "market": "moneyline", "pick": "home", "american_odds": -135 },
      { "home_team": "PHI", "away_team": "DAL", "market": "spread", "pick": "away", "line": 3.5, "american_odds": -110 }
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

  async function doSingle() {
    try {
      setBusy(true);
      setErr(null);

      if (betMode === "team") {
        const r = await api.single(single);
        setResult(r);
      } else {
        // Send a "player_prop" single payload.
        // Shape matches a common backend pattern; we cast to satisfy TS and avoid engine edits.
        const payload = {
          type: "player_prop",
          player: playerName,
          metric: playerMetric,            // e.g., "Passing Yards"
          outcome: playerOverUnder,        // "over" | "under"
          line: playerLine,                // e.g., 275.5
          american_odds: playerOdds,
        } as unknown as SingleReq;

        const r = await api.single(payload);
        setResult(r);
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
      const r = await api.parlay(parlay);
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
      await api.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Refresh failed");
    } finally {
      setBusy(false);
    }
  }

  // TS-safe implied prob from american_odds for TEAM mode
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

  /* ---------- overlays ---------- */
  return (
    <>
      {phase !== "section" && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center fade-in">
          {(phase === "menu" || phase === "home") ? (
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: "url(/assets/menu/main-menu-bg.png)" }}
            />
          ) : (
            <div className="absolute inset-0 bg-[#0b1016]" />
          )}

          <img
            src="/assets/pixel/logo/best-bet-nfl.png"
            alt="Best Bet NFL"
            className="relative w-[280px] md:w-[360px] drop-shadow-xl mb-6"
          />

          {phase === "boot" && (
            <div className="relative w-[70%] max-w-xl mt-4">
              <div className="h-3 rounded-sm bg-white/10 border border-white/20">
                <div className="h-full bg-white/80" style={{ width: `${bootProgress}%` }} />
              </div>
              <div className="mt-2 text-center text-xs text-white/70">
                Loading odds engine… {bootProgress}%
              </div>
            </div>
          )}

          {phase === "home" && (
            <div className="relative w-[92%] max-w-xl mt-2">
              <button
                onClick={() => setPhase("menu")}
                className="w-full px-6 py-4 rounded-xl font-bold text-center shadow-lg transition"
                aria-label="Start"
                style={{
                  backgroundColor: "#5b63ff",
                  borderColor: "rgba(255,255,255,0.28)",
                  color: "#ffffff",
                  borderWidth: 1
                }}
              >
                START
              </button>
              <div className="mt-3 text-center text-xs text-white/80">
                Press START to enter the main menu
              </div>
            </div>
          )}

          {phase === "menu" && (
            <div className="relative w-[92%] max-w-3xl mt-2">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-2">
                <button
                  onClick={() => { setTab("single"); setPhase("section"); }}
                  className="menu-item text-white shadow-lg"
                  style={{ backgroundColor: "#2b9a66", borderColor: "rgba(255,255,255,0.28)", borderWidth: 1 }}
                >
                  <img src="/assets/icons/money-bag-bw.png" className="bw" alt="" />
                  <img src="/assets/icons/money-bag-color.png" className="color" alt="" />
                  <span>Place Bet</span>
                </button>

                <button
                  onClick={() => { setTab("batch"); setPhase("section"); }}
                  className="menu-item text-white shadow-lg"
                  style={{ backgroundColor: "#2b6ea6", borderColor: "rgba(255,255,255,0.28)", borderWidth: 1 }}
                >
                  <img src="/assets/icons/stats-graph-bw.png" className="bw" alt="" />
                  <img src="/assets/icons/stats-graph-color.png" className="color" alt="" />
                  <span>My Stats</span>
                </button>

                <button
                  onClick={() => { setTab("parlay"); setPhase("section"); }}
                  className="menu-item shadow-lg"
                  style={{ backgroundColor: "#d1a500", borderColor: "rgba(0,0,0,0.25)", borderWidth: 1, color: "#000" }}
                >
                  <img src="/assets/icons/settings-gear-bw.png" className="bw" alt="" />
                  <img src="/assets/icons/settings-gear-color.png" className="color" alt="" />
                  <span>Settings</span>
                </button>

                <button
                  onClick={() => { setPhase("home"); }}
                  className="menu-item text-white shadow-lg"
                  style={{ backgroundColor: "#bf2b3a", borderColor: "rgba(255,255,255,0.28)", borderWidth: 1 }}
                >
                  <img src="/assets/icons/exit-stop-bw.png" className="bw" alt="" />
                  <img src="/assets/icons/exit-stop-color.png" className="color" alt="" />
                  <span>Exit</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------- MAIN APP CONTENT ---------- */}
      <div className="min-h-screen">
        {phase === "section" && (
          <div className="fixed top-3 left-3 z-40">
            <button
              onClick={() => setPhase("menu")}
              className="btn"
              aria-label="Return to Main Menu"
              title="Main Menu"
              style={{ backgroundColor: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.18)", borderWidth: 1 }}
            >
              Main Menu
            </button>
          </div>
        )}

        <div
          className="hero"
          style={phase === "section" ? { backgroundImage: `url('${heroBg}')` } : undefined}
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

        <div className="mx-auto max-w-6xl px-4 py-6 grid md:grid-cols-3 gap-6">
          {/* Menu (kept) */}
          <div className="card h-fit">
            <div className="text-sm uppercase tracking-widest text-white/60 mb-3">Main Menu</div>
            <div className="grid gap-2">
              <button className={`btn ${tab === "single" ? "btn-primary" : ""}`} onClick={() => setTab("single")}>Single / Moneyline / Spread</button>
              <button className={`btn ${tab === "parlay" ? "btn-primary" : ""}`} onClick={() => setTab("parlay")}>Parlay</button>
              <button className={`btn ${tab === "batch" ? "btn-primary" : ""}`} onClick={() => setTab("batch")}>Batch JSON</button>
            </div>
            <div className="mt-4 text-xs text-white/60">Use Start → Menu or switch here anytime.</div>
          </div>

          {/* Panels */}
          <div className="md:col-span-2 grid gap-6">
            {/* SINGLE: now supports Team AND Player bets */}
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
                          <div className="label">Line (e.g., +3.5)</div>
                          <input
                            type="number"
                            className="input"
                            value={(single as any).line ?? 0}
                            onChange={e => setSingle({ ...(single as any), line: clampNum(e.target.value, 0) } as unknown as SingleReq)}
                          />
                        </div>
                      )}
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
                        <div className="label">Metric</div>
                        <select className="input" value={playerMetric} onChange={e => setPlayerMetric(e.target.value as PlayerMetric)}>
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

            {/* PARLAY (unchanged UI / settings bg) */}
            {tab === "parlay" && (
              <div className="card">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">Parlay</h2>
                  <div className="text-white/60 text-sm flex items-center gap-2"><Info size={16}/> Independent calc</div>
                </div>

                {(parlay as any).legs.map((leg: any, i: number) => (
                  <div key={i} className="grid-cols-form mb-2">
                    <div>
                      <div className="label">Home</div>
                      <input className="input" value={leg.home_team} onChange={e => {
                        const legs = [...(parlay as any).legs]; legs[i] = { ...legs[i], home_team: e.target.value }; setParlay({ ...(parlay as any), legs } as unknown as ParlayReq);
                      }}/>
                    </div>
                    <div>
                      <div className="label">Away</div>
                      <input className="input" value={leg.away_team} onChange={e => {
                        const legs = [...(parlay as any).legs]; legs[i] = { ...legs[i], away_team: e.target.value }; setParlay({ ...(parlay as any), legs } as unknown as ParlayReq);
                      }}/>
                    </div>
                    <div>
                      <div className="label">Market</div>
                      <select className="input" value={leg.market} onChange={e => {
                        const legs = [...(parlay as any).legs]; legs[i] = { ...legs[i], market: e.target.value as any }; setParlay({ ...(parlay as any), legs } as unknown as ParlayReq);
                      }}>
                        <option value="moneyline">Moneyline</option>
                        <option value="spread">Spread</option>
                      </select>
                    </div>
                    <div>
                      <div className="label">Pick</div>
                      <select className="input" value={leg.pick} onChange={e => {
                        const legs = [...(parlay as any).legs]; legs[i] = { ...legs[i], pick: e.target.value as any }; setParlay({ ...(parlay as any), legs } as unknown as ParlayReq);
                      }}>
                        <option value="home">Home</option>
                        <option value="away">Away</option>
                      </select>
                    </div>
                    {leg.market === "spread" && (
                      <div>
                        <div className="label">Line</div>
                        <input type="number" className="input" value={leg.line ?? 0} onChange={e => {
                          const legs = [...(parlay as any).legs]; legs[i] = { ...legs[i], line: clampNum(e.target.value, 0) }; setParlay({ ...(parlay as any), legs } as unknown as ParlayReq);
                        }}/>
                      </div>
                    )}
                    <div>
                      <div className="label">American Odds</div>
                      <input type="number" className="input" value={leg.american_odds} onChange={e => {
                        const legs = [...(parlay as any).legs]; legs[i] = { ...legs[i], american_odds: clampNum(e.target.value, -110) }; setParlay({ ...(parlay as any), legs } as unknown as ParlayReq);
                      }}/>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="btn" onClick={() => {
                        const legs = [...(parlay as any).legs]; legs.splice(i, 1); setParlay({ ...(parlay as any), legs } as unknown as ParlayReq);
                      }}><Minus className="h-4 w-4"/></button>
                      <button className="btn" onClick={() => {
                        const legs = [...(parlay as any).legs]; legs.splice(i + 1, 0, { ...leg }); setParlay({ ...(parlay as any), legs } as unknown as ParlayReq);
                      }}><Plus className="h-4 w-4"/></button>
                    </div>
                  </div>
                ))}

                <div className="mt-2 grid-cols-form">
                  <div>
                    <div className="label">Stake</div>
                    <input type="number" className="input" value={(parlay as any).stake} onChange={e => setParlay({ ...(parlay as any), stake: clampNum(e.target.value, 10) } as unknown as ParlayReq)}/>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <button className="btn btn-primary" onClick={doParlay} disabled={busy}>
                    <TrendingUp className="mr-2 h-4 w-4" /> Evaluate
                  </button>
                  {busy && <div className="text-white/60 text-sm">Crunching numbers…</div>}
                  {err && <div className="text-red-400 text-sm">{err}</div>}
                </div>

                {result && "parlay_probability_independent_pct" in result && (
                  <div className="mt-6 bg-white/5 border border-white/10 rounded-xl p-4">
                    <div className="text-sm text-white/70">Model Output</div>
                    <div className="mt-2 text-xl font-semibold">Hit Probability: {result.parlay_probability_independent_pct}</div>
                    <div className="text-white/70">EV: {result.expected_value.toFixed(2)}</div>
                    <div className="text-white/70">Payout if Win: {result.payout_if_win.toFixed(2)}</div>
                  </div>
                )}
              </div>
            )}

            {/* BATCH (stats bg) */}
            {tab === "batch" && (
              <div className="card">
                <h2 className="text-lg font-semibold mb-4">Batch (JSON)</h2>
                <textarea className="input min-h-[280px]" value={batchPayload} onChange={e => setBatchPayload(e.target.value)} />
                <div className="mt-4 flex items-center gap-3">
                  <button className="btn btn-primary" onClick={doBatch} disabled={busy}>
                    <TrendingUp className="mr-2 h-4 w-4" /> Evaluate
                  </button>
                  {busy && <div className="text-white/60 text-sm">Crunching numbers…</div>}
                  {err && <div className="text-red-400 text-sm">{err}</div>}
                </div>

                {result && "singles" in result && (
                  <div className="mt-6 bg-white/5 border border-white/10 rounded-xl p-4">
                    <div className="text-sm text-white/70">Model Output</div>
                    <div className="mt-2 text-xl font-semibold">
                      Singles: {result.singles.length} • Parlays: {result.parlays.length}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="footer">
          © {new Date().getFullYear()} Best Bet NFL — Educational use only. Not financial advice.
        </div>
      </div>
    </>
  );
}







