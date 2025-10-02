"use client";

import { useMemo, useState, useEffect } from "react";
import { api, SingleReq, ParlayReq, ParlayResp, SingleResp } from "@/lib/api";
import { RefreshCw, Percent, Plus, Minus, Info, TrendingUp } from "lucide-react";

/** Utility: American odds -> implied probability (0..1) */
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
type AnyResult = SingleResp | ParlayResp | { singles: SingleResp[]; parlays: ParlayResp[] } | null;

type Phase = "boot" | "landing" | "menu" | "section";

export default function Page() {
  const [phase, setPhase] = useState<Phase>("boot");
  const [bootProgress, setBootProgress] = useState(0);
  useEffect(() => {
    if (phase !== "boot") return;
    const total = 2250;
    const start = performance.now();
    let raf = 0;
    const loop = () => {
      const t = performance.now() - start;
      const p = Math.min(100, Math.round((t/total)*100));
      setBootProgress(p);
      if (p >= 100) {
        setPhase("landing");
        setTimeout(() => setPhase("menu"), 600);
      } else {
        raf = requestAnimationFrame(loop);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  const [tab, setTab] = useState<Tab>("single");
  const [result, setResult] = useState<AnyResult>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ---------------- Existing state & helpers (kept as-is) ----------------
  const [single, setSingle] = useState<SingleReq>({
    home_team: "PIT",
    away_team: "BAL",
    market: "moneyline",
    pick: "home",
    american_odds: -120,
  });

  const [parlay, setParlay] = useState<ParlayReq>({
    legs: [
      { home_team: "KC", away_team: "CIN", market: "moneyline", pick: "home", american_odds: -135 },
      { home_team: "PHI", away_team: "DAL", market: "spread", pick: "away", line: +3.5, american_odds: -110 },
    ],
    stake: 10,
  });

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

  function clampNum(n: any, fallback = 0) {
    const x = Number(n);
    return Number.isFinite(x) ? x : fallback;
  }

  async function doSingle() {
    try {
      setBusy(true); setErr(null);
      const r = await api.single(single);
      setResult(r);
    } catch (e: any) {
      setErr(e?.message ?? "Request failed");
    } finally {
      setBusy(false);
    }
  }
  async function doParlay() {
    try {
      setBusy(true); setErr(null);
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
      setBusy(true); setErr(null);
      const payload = JSON.parse(batchPayload);
      const r = await api.batch(payload);
      setResult(r as AnyResult);
    } catch (e: any) {
      setErr(e?.message ?? "Invalid JSON or request failed");
    } finally {
      setBusy(false);
    }
  }

  const impliedSingle = useMemo(() => impliedFromAmerican(single.american_odds), [single.american_odds]);

  // ---------------- Overlay: Boot + Main Menu (non-invasive) ----------------
  return (
    <>
      {/* Boot / Mach-loading & Main Menu overlays */}
      {phase !== "section" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backgrounds */}
          {phase === "menu" ? (
            <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url(/assets/menu/main-menu-bg.png)" }} />
          ) : (
            <div className="absolute inset-0 bg-[#0b1016]" />
          )}

          {/* Logo */}
          <img src="/assets/pixel/logo/best-bet-nfl.png" alt="Best Bet NFL" className="relative w-[280px] md:w-[360px] drop-shadow-xl" />

          {/* Progress bar (boot only) */}
          {phase === "boot" && (
            <div className="absolute bottom-[20%] w-[70%] max-w-xl">
              <div className="h-3 rounded-sm bg-white/10 border border-white/20">
                <div className="h-full bg-white/80" style={{ width: `${bootProgress}%` }} />
              </div>
              <div className="mt-2 text-center text-xs text-white/70">Loading odds engine… {bootProgress}%</div>
            </div>
          )}

          {/* Main Menu (B/W → color hover only here) */}
          {phase === "menu" && (
            <div className="relative w-[90%] max-w-2xl">
              <div className="pixel-panel">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-6">
                  <button onClick={() => { setTab('single'); setPhase('section'); }} className="menu-item">
                    <img src="/assets/icons/money-bag-bw.png" className="bw" alt="" />
                    <img src="/assets/icons/money-bag-color.png" className="color" alt="" />
                    <span>Single</span>
                  </button>
                  <button onClick={() => { setTab('parlay'); setPhase('section'); }} className="menu-item">
                    <img src="/assets/icons/stats-graph-bw.png" className="bw" alt="" />
                    <img src="/assets/icons/stats-graph-color.png" className="color" alt="" />
                    <span>Parlay</span>
                  </button>
                  <button onClick={() => { setTab('batch'); setPhase('section'); }} className="menu-item">
                    <img src="/assets/icons/settings-gear-bw.png" className="bw" alt="" />
                    <img src="/assets/icons/settings-gear-color.png" className="color" alt="" />
                    <span>Batch</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------- Your existing content (unchanged) ---------- */}
      <div className="min-h-screen">
        {/* Header */}
        <div className="hero">
          <div className="mx-auto max-w-6xl px-4 py-16">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <img src="/assets/pixel/logo/best-bet-nfl.png" alt="Best Bet NFL" className="w-14 h-14" />
                <div>
                  <h1 className="text-2xl font-bold leading-tight">Best Bet NFL</h1>
                  <p className="text-white/70">Actual probabilities for NFL bets</p>
                </div>
              </div>
              <button className="btn" onClick={() => api.refresh()}>
                <RefreshCw className="mr-2 h-4 w-4" /> Refresh data
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="mx-auto max-w-6xl px-4 py-6 grid md:grid-cols-3 gap-6">
          {/* Menu (existing tab buttons, kept) */}
          <div className="card h-fit">
            <div className="text-sm uppercase tracking-widest text-white/60 mb-3">Main Menu</div>
            <div className="grid gap-2">
              <button className={`btn ${tab === "single" ? "btn-primary" : ""}`} onClick={() => setTab("single")}>Single / Moneyline / Spread</button>
              <button className={`btn ${tab === "parlay" ? "btn-primary" : ""}`} onClick={() => setTab("parlay")}>Parlay</button>
              <button className={`btn ${tab === "batch" ? "btn-primary" : ""}`} onClick={() => setTab("batch")}>Batch JSON</button>
            </div>
            <div className="mt-4 text-xs text-white/60">
              Tip: Use the big blue **menu** first time visitors see, or use these buttons to switch views.
            </div>
          </div>

          {/* Panels */}
          <div className="md:col-span-2 grid gap-6">
            {/* SINGLE */}
            {tab === "single" && (
              <div className="card">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">Single Bet</h2>
                  <div className="text-white/60 text-sm flex items-center gap-2"><Percent size={16}/>Implied: {pct(impliedSingle)}</div>
                </div>

                <div className="grid-cols-form">
                  <div>
                    <div className="label">Home Team</div>
                    <input className="input" value={single.home_team} onChange={e => setSingle({ ...single, home_team: e.target.value })}/>
                  </div>
                  <div>
                    <div className="label">Away Team</div>
                    <input className="input" value={single.away_team} onChange={e => setSingle({ ...single, away_team: e.target.value })}/>
                  </div>
                  <div>
                    <div className="label">Market</div>
                    <select className="input" value={single.market} onChange={e => setSingle({ ...single, market: e.target.value as any })}>
                      <option value="moneyline">Moneyline</option>
                      <option value="spread">Spread</option>
                    </select>
                  </div>
                  <div>
                    <div className="label">Pick</div>
                    <select className="input" value={single.pick} onChange={e => setSingle({ ...single, pick: e.target.value as any })}>
                      <option value="home">Home</option>
                      <option value="away">Away</option>
                    </select>
                  </div>
                  <div>
                    <div className="label">American Odds</div>
                    <input type="number" className="input" value={single.american_odds} onChange={e => setSingle({ ...single, american_odds: clampNum(e.target.value, -110) })}/>
                  </div>
                  {single.market === "spread" && (
                    <div>
                      <div className="label">Line (e.g., +3.5)</div>
                      <input type="number" className="input" value={single.line ?? 0} onChange={e => setSingle({ ...single, line: clampNum(e.target.value, 0) })}/>
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

                {result && "probability" in result && (
                  <div className="mt-6 bg-white/5 border border-white/10 rounded-xl p-4">
                    <div className="text-sm text-white/70">Model Output</div>
                    <div className="mt-2 text-xl font-semibold">Hit Probability: {pct(result.probability)}</div>
                    <div className="text-white/70">EV: {result.expected_value.toFixed(2)}</div>
                  </div>
                )}
              </div>
            )}

            {/* PARLAY */}
            {tab === "parlay" && (
              <div className="card">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">Parlay</h2>
                  <div className="text-white/60 text-sm flex items-center gap-2"><Info size={16}/> Independent calc</div>
                </div>

                {parlay.legs.map((leg, i) => (
                  <div key={i} className="grid-cols-form mb-2">
                    <div>
                      <div className="label">Home</div>
                      <input className="input" value={leg.home_team} onChange={e => {
                        const legs = [...parlay.legs]; legs[i] = { ...legs[i], home_team: e.target.value }; setParlay({ ...parlay, legs });
                      }}/>
                    </div>
                    <div>
                      <div className="label">Away</div>
                      <input className="input" value={leg.away_team} onChange={e => {
                        const legs = [...parlay.legs]; legs[i] = { ...legs[i], away_team: e.target.value }; setParlay({ ...parlay, legs });
                      }}/>
                    </div>
                    <div>
                      <div className="label">Market</div>
                      <select className="input" value={leg.market} onChange={e => {
                        const legs = [...parlay.legs]; legs[i] = { ...legs[i], market: e.target.value as any }; setParlay({ ...parlay, legs });
                      }}>
                        <option value="moneyline">Moneyline</option>
                        <option value="spread">Spread</option>
                      </select>
                    </div>
                    <div>
                      <div className="label">Pick</div>
                      <select className="input" value={leg.pick} onChange={e => {
                        const legs = [...parlay.legs]; legs[i] = { ...legs[i], pick: e.target.value as any }; setParlay({ ...parlay, legs });
                      }}>
                        <option value="home">Home</option>
                        <option value="away">Away</option>
                      </select>
                    </div>
                    {leg.market === "spread" && (
                      <div>
                        <div className="label">Line</div>
                        <input type="number" className="input" value={leg.line ?? 0} onChange={e => {
                          const legs = [...parlay.legs]; legs[i] = { ...legs[i], line: clampNum(e.target.value, 0) }; setParlay({ ...parlay, legs });
                        }}/>
                      </div>
                    )}
                    <div>
                      <div className="label">American Odds</div>
                      <input type="number" className="input" value={leg.american_odds} onChange={e => {
                        const legs = [...parlay.legs]; legs[i] = { ...legs[i], american_odds: clampNum(e.target.value, -110) }; setParlay({ ...parlay, legs });
                      }}/>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="btn" onClick={() => {
                        const legs = [...parlay.legs]; legs.splice(i, 1); setParlay({ ...parlay, legs });
                      }}><Minus className="h-4 w-4"/></button>
                      <button className="btn" onClick={() => {
                        const legs = [...parlay.legs]; legs.splice(i + 1, 0, { ...leg }); setParlay({ ...parlay, legs });
                      }}><Plus className="h-4 w-4"/></button>
                    </div>
                  </div>
                ))}

                <div className="mt-2 grid-cols-form">
                  <div>
                    <div className="label">Stake</div>
                    <input type="number" className="input" value={parlay.stake} onChange={e => setParlay({ ...parlay, stake: clampNum(e.target.value, 10) })}/>
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

            {/* BATCH */}
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
                    <div className="mt-2 text-xl font-semibold">Singles: {result.singles.length} • Parlays: {result.parlays.length}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="footer">
          © {new Date().getFullYear()} Best Bet NFL — For informational purposes only.
        </div>
      </div>
    </>
  );
}





