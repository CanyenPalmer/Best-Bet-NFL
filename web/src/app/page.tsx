"use client";

import { useEffect, useMemo, useState } from "react";
import { api, SingleReq, ParlayReq, ParlayResp, SingleResp } from "@/lib/api";
import { RefreshCw, Percent, Info, TrendingUp, ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";

/* ---------------- Helpers ---------------- */
function impliedFromAmerican(odds: number): number {
  const ao = Number(odds);
  if (!Number.isFinite(ao)) return 0.5;
  return ao >= 0 ? 100 / (ao + 100) : Math.abs(ao) / (Math.abs(ao) + 100);
}
function pct01(n: number | undefined | null) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const p = Math.max(0, Math.min(1, Number(n)));
  return `${(p * 100).toFixed(2)}%`;
}

type Tab = "single" | "parlay" | "batch";
type AnyResult =
  | SingleResp
  | ParlayResp
  | { singles: SingleResp[]; parlays: ParlayResp[] }
  | null;

/* ---------------- Phases ---------------- */
type Phase = "boot" | "start" | "main" | "placebet" | "stats" | "settings";

/* ---------------- Bet Modes ---------------- */
type BetMode = "team" | "player";

/* ---------------- Player metric → prop_kind ---------------- */
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

/* ---------------- Generic Dialogue Box (sprite + prompt) ---------------- */
function DialogueBox({
  spriteSrc,
  title,
  lines,
  large = false,
}: {
  spriteSrc: string;
  title?: string;
  lines: string[];
  large?: boolean;
}) {
  return (
    <div className={`w-full ${large ? "bg-black/70" : "bg-black/60"} rounded-2xl p-4 md:p-5 border border-white/10 flex gap-4 items-center`}>
      <div className={`${large ? "w-20 h-20" : "w-14 h-14"} rounded-xl overflow-hidden bg-black/40 border border-white/10 shrink-0 flex items-center justify-center`}>
        <img
          src={spriteSrc}
          alt={title || "Sprite"}
          className="object-contain w-full h-full"
          onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
        />
      </div>
      <div className="flex-1">
        {title && <div className={`font-semibold ${large ? "text-base md:text-lg" : "text-sm"}`}>{title}</div>}
        <div className={`${large ? "text-sm md:text-base" : "text-xs"} text-white/90 leading-6`}>
          {lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Evaluation Dialogue Summary ---------------- */
function DialogueSummary({ result }: { result: AnyResult }) {
  if (!result) return null;

  const tryField = (obj: any, keys: string[]) => {
    for (const k of keys) if (obj && obj[k] != null) return obj[k];
    return undefined;
  };

  const isBatch = (r: any) => r && (typeof r === "object") && ("singles" in r || "parlays" in r);
  const isParlay = (r: any) => r && (typeof r === "object") && ("legs" in r || "combined" in r || "parlay" in r);
  const isSingle = (r: any) => r && (typeof r === "object") && ("probability" in r || "p_win" in r);

  const lines: string[] = [];
  let title = "Evaluation Summary";

  if (isBatch(result)) {
    const b: any = result;
    const sc = Array.isArray(b.singles) ? b.singles.length : 0;
    const pc = Array.isArray(b.parlays) ? b.parlays.length : 0;
    title = "Batch Results";
    lines.push(`Singles evaluated: ${sc}`);
    lines.push(`Parlays evaluated: ${pc}`);
    if (sc > 0) {
      const s0 = b.singles[0];
      const p = tryField(s0, ["probability", "p_win"]);
      const ev = tryField(s0, ["ev", "expected_value"]);
      lines.push(`Example single → True odds: ${pct01(p)} | EV: ${ev ?? "—"}`);
    }
    if (pc > 0) {
      const p0 = b.parlays[0];
      const p = tryField(p0, ["probability", "p_win", "combined_probability"]);
      lines.push(`Example parlay → True odds: ${pct01(p)}`);
    }
  } else if (isParlay(result)) {
    const p = tryField(result as any, ["probability", "p_win", "combined_probability"]);
    const payout = tryField(result as any, ["payout", "payout_if_win"]);
    const ev = tryField(result as any, ["ev", "expected_value"]);
    const legCount = Array.isArray((result as any).legs)
      ? (result as any).legs.length
      : tryField(result as any, ["leg_count"]) ?? "—";
    title = "Parlay Results";
    lines.push(`Legs: ${legCount}`);
    lines.push(`True odds: ${pct01(p)}`);
    if (payout != null) lines.push(`Payout if win: ${payout}`);
    if (ev != null) lines.push(`Expected Value (EV): ${ev}`);
  } else if (isSingle(result)) {
    const p = tryField(result as any, ["probability", "p_win"]);
    const payout = tryField(result as any, ["payout", "payout_if_win"]);
    const ev = tryField(result as any, ["ev", "expected_value"]);
    const market = tryField(result as any, ["market"]);
    const team = tryField(result as any, ["team"]);
    const player = tryField(result as any, ["player"]);
    title = player ? `Single • ${player}` : `Single${market ? ` • ${market}` : ""}`;
    if (team) lines.push(`Team: ${team}`);
    lines.push(`True odds: ${pct01(p)}`);
    if (payout != null) lines.push(`Payout if win: ${payout}`);
    if (ev != null) lines.push(`Expected Value (EV): ${ev}`);
  } else {
    title = "Result";
    lines.push("Evaluation complete. See details below.");
  }

  return (
    <DialogueBox
      spriteSrc="/assets/avatars/player.png"
      title={title}
      lines={lines}
      large
    />
  );
}

/* ---------------- Page ---------------- */
export default function Page() {
  /* Boot */
  const [phase, setPhase] = useState<Phase>("boot");
  const [bootProgress, setBootProgress] = useState(0);

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
        setPhase("start");
      } else {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  /* ---------- Betting UI state ---------- */
  const [single, setSingle] = useState<SingleReq>(() => ({
    home_team: "PIT",
    away_team: "BAL",
    market: "moneyline",
    pick: "home",
    american_odds: -120,
    line: 0,
    stake: 100,
  } as unknown as SingleReq));
  const [betMode, setBetMode] = useState<BetMode>("team");
  const [playerName, setPlayerName] = useState<string>("Patrick Mahomes");
  const [playerMetric, setPlayerMetric] =
    useState<keyof typeof PROP_KIND_BY_LABEL>("Passing Yards");
  const [playerOverUnder, setPlayerOverUnder] =
    useState<"over" | "under">("over");
  const [playerLine, setPlayerLine] = useState<number>(275.5);
  const [playerOdds, setPlayerOdds] = useState<number>(-110);
  const [playerOpponent, setPlayerOpponent] = useState<string>("BUF");
  const [playerStake, setPlayerStake] = useState<number>(100);

  // Parlay supports mixed legs: team *and* player prop
  const [parlay, setParlay] = useState<any>(() => ({
    legs: [
      { leg_type: "team", home_team: "KC", away_team: "CIN", market: "moneyline", pick: "home", american_odds: -135 },
      { leg_type: "team", home_team: "PHI", away_team: "DAL", market: "spread", pick: "away", line: +3.5, american_odds: -110 },
      // example player leg (shows UI shape)
      // { leg_type: "player", player: "Justin Jefferson", prop_kind: "wr_rec_yards", side: "over", line: 89.5, opponent: "GB", american_odds: -115 }
    ],
    stake: 10,
  }));
  type UILeg =
    | {
        leg_type: "team";
        home_team?: string;
        away_team?: string;
        market?: "moneyline" | "spread";
        pick?: "home" | "away";
        line?: number;
        american_odds?: number;
      }
    | {
        leg_type: "player";
        player?: string;
        prop_kind?: string;
        side?: "over" | "under";
        line?: number;
        opponent?: string;
        american_odds?: number;
      };
  const parlayLegs: UILeg[] = Array.isArray(parlay?.legs) ? (parlay.legs as UILeg[]) : [];

  // Batch JSON payload
  const [batchPayload, setBatchPayload] = useState<string>(`{
  "singles": [
    { "market": "moneyline", "team": "PIT", "opponent": "BAL", "odds": -120, "stake": 100 }
  ],
  "parlays": [
    { "legs": [
      { "market": "moneyline", "team": "KC", "opponent": "CIN", "odds": -135 },
      { "market": "spread", "team": "DAL", "opponent": "PHI", "spread_line": 3.5, "odds": -110 },
      { "market": "prop", "player": "Justin Jefferson", "prop_kind": "wr_rec_yards", "side": "over", "line": 89.5, "opponent": "GB", "odds": -115 }
    ], "stake": 10 }
  ]
}`);

  /* Tabs for Place Bet */
  const [tab, setTab] = useState<Tab>("single");

  /* Busy/result/error */
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AnyResult>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showResultDetails, setShowResultDetails] = useState<boolean>(false);

  /* ---------- Actions ---------- */
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
            ? { market: "moneyline", team, opponent, odds, stake, odds_format: "american" }
            : { market: "spread", team, opponent, spread_line: Number((single as any).line ?? 0), odds, stake, odds_format: "american" };

        const r = await api.single(payload);
        setResult(r);
      } else {
        const payload = {
          market: "prop",
          player: playerName,
          prop_kind: PROP_KIND_BY_LABEL[playerMetric],
          side: playerOverUnder,
          line: Number(playerLine),
          opponent: playerOpponent,
          odds: Number(playerOdds),
          stake: Number(playerStake),
        };
        const r = await api.single(payload as any);
        setResult(r as AnyResult);
      }
      setShowResultDetails(false);
    } catch (e: any) {
      setErr(e?.message ?? "Request failed");
    } finally {
      setBusy(false);
    }
  }

  function toParlayPayload(legs: UILeg[], stake: number): ParlayReq {
    // Build mixed-leg payload for backend: team legs as moneyline/spread; player legs as market: "prop"
    const builtLegs = legs.map((leg: UILeg) => {
      if (leg.leg_type === "team") {
        const t = leg as UILeg & { leg_type: "team" };
        if (t.market === "moneyline") {
          // send team/opponent using pick
          const home = String(t.home_team || "");
          const away = String(t.away_team || "");
          const team = t.pick === "home" ? home : away;
          const opponent = t.pick === "home" ? away : home;
          return {
            market: "moneyline",
            team,
            opponent,
            odds: Number(t.american_odds ?? 0),
            odds_format: "american",
          };
        } else {
          const home = String(t.home_team || "");
          const away = String(t.away_team || "");
          const team = t.pick === "home" ? home : away;
          const opponent = t.pick === "home" ? away : home;
          return {
            market: "spread",
            team,
            opponent,
            spread_line: Number(t.line ?? 0),
            odds: Number(t.american_odds ?? 0),
            odds_format: "american",
          };
        }
      } else {
        const p = leg as UILeg & { leg_type: "player" };
        return {
          market: "prop",
          player: String(p.player || ""),
          prop_kind: String(p.prop_kind || ""),
          side: p.side ?? "over",
          line: Number(p.line ?? 0),
          opponent: String(p.opponent || ""),
          odds: Number(p.american_odds ?? 0),
          odds_format: "american",
        };
      }
    });
    return { legs: builtLegs, stake: Number(stake ?? 0) } as unknown as ParlayReq;
  }

  async function doParlay() {
    try {
      setBusy(true);
      setErr(null);
      const payload = toParlayPayload(parlayLegs, Number(parlay?.stake ?? 0));
      const r = await api.parlay(payload);
      setResult(r);
      setShowResultDetails(false);
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
      setShowResultDetails(false);
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

  /* ---------- Main Menu Sprites ---------- */
  type MenuKey = "place" | "stats" | "settings" | "exit";
  const [hoverKey, setHoverKey] = useState<MenuKey | null>(null);
  const [focusKey, setFocusKey] = useState<MenuKey | null>(null);

  const menuSprites: Record<MenuKey, { bw: string; color: string; label: string; lines: string[]; tileBg: string }> = {
    place: {
      bw: "/assets/icons/money-bag-bw.png",
      color: "/assets/icons/money-bag-color.png",
      label: "Place Bet",
      lines: ["Simulate singles, parlays, and batch slips.", "See true odds and EV instantly."],
      tileBg: "bg-emerald-600/30",
    },
    stats: {
      bw: "/assets/icons/stats-graph-bw.png",
      color: "/assets/icons/stats-graph-color.png",
      label: "My Stats",
      lines: ["Session totals & hit rates.", "Track EV and profit over time."],
      tileBg: "bg-sky-600/30",
    },
    settings: {
      bw: "/assets/icons/settings-gear-bw.png",
      color: "/assets/icons/settings-gear-color.png",
      label: "Settings",
      lines: ["Refresh weekly stats.", "Manage UI & data options."],
      tileBg: "bg-violet-600/30",
    },
    exit: {
      bw: "/assets/icons/exit-stop-bw.png",
      color: "/assets/icons/exit-stop-color.png",
      label: "Exit",
      lines: ["Return to Start screen.", "You can always come back!"],
      tileBg: "bg-rose-600/30",
    },
  };

  function selectMenu(k: MenuKey) {
    setFocusKey(k);
    if (k === "place") setPhase("placebet");
    if (k === "stats") setPhase("stats");
    if (k === "settings") setPhase("settings");
    if (k === "exit") {
      // Exit returns to START menu (not main)
      setResult(null);
      setErr(null);
      setTab("single");
      setPhase("start");
    }
  }

  /* ---------- Dynamic backgrounds ---------- */
  const placeBg =
    tab === "single"
      ? "/assets/bg/bg-betting.png"
      : tab === "batch"
      ? "/assets/bg/bg-stats.png"
      : "/assets/bg/bg-settings.png";

  /* ---------- RENDER ---------- */
  return (
    <>
      {/* BOOT */}
      {phase === "boot" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
          <div className="text-center">
            {/* BIGGER LOGO above progress bar */}
            <div className="mx-auto w-56 h-56 mb-5 flex items-center justify-center">
              <img
                src="/assets/pixel/logo/best-bet-nfl.png"
                alt="Best Bet NFL"
                className="object-contain w-full h-full"
                onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
              />
            </div>
            <div className="text-2xl font-bold mb-4">Best Bet NFL</div>
            <div className="w-64 h-3 bg-white/10 rounded overflow-hidden mx-auto">
              <div className="h-full bg-white" style={{ width: `${bootProgress}%` }} />
            </div>
            <div className="text-white/60 text-sm mt-2">Loading... {bootProgress}%</div>
          </div>
        </div>
      )}

      {/* START MENU */}
      {phase === "start" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
          <div className="text-center space-y-6">
            <div className="mx-auto w-44 h-44">
              <img
                src="/assets/pixel/logo/best-bet-nfl.png"
                alt="Best Bet NFL"
                className="object-contain w-full h-full"
                onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
              />
            </div>
            <div className="text-4xl font-extrabold">Best Bet NFL</div>
            <button className="btn btn-primary" onClick={() => setPhase("main")}>Start</button>
          </div>
        </div>
      )}

      {/* MAIN MENU with 4 sprites */}
      {phase === "main" && (
        <div
          className="min-h-screen relative flex items-center justify-center bg-cover bg-center"
          style={{ backgroundImage: `url(/assets/menu/main-menu-bg.png)` }}
        >
          <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.35),rgba(0,0,0,0.85))]" />

          <div className="relative container mx-auto px-4 py-10">
            {/* Best Bet logo above options */}
            <div className="mx-auto w-40 h-40 mb-4 flex items-center justify-center">
              <img
                src="/assets/pixel/logo/best-bet-nfl.png"
                alt="Best Bet NFL"
                className="object-contain w-full h-full"
                onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
              />
            </div>

            <div className="flex items-center gap-3 text-white/80 text-sm mb-4">
              <TrendingUp size={16} />
              <span>Best Bet NFL</span>
            </div>

            <h1 className="text-2xl md:text-3xl font-bold text-white mb-6 text-center">Main Menu</h1>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {(["place", "stats", "settings", "exit"] as MenuKey[]).map((k) => {
                const s = menuSprites[k];
                const active = hoverKey === k || focusKey === k;
                const src = active ? s.color : s.bw;
                return (
                  <button
                    key={k}
                    className={`group ${s.tileBg} border border-white/10 rounded-2xl p-4 hover:border-white/30 focus:border-white/30 transition`}
                    onMouseEnter={() => setHoverKey(k)}
                    onMouseLeave={() => setHoverKey(null)}
                    onFocus={() => setFocusKey(k)}
                    onBlur={() => setFocusKey(null)}
                    onClick={() => selectMenu(k)}
                  >
                    <div className="w-full aspect-square rounded-xl bg-black/40 overflow-hidden mb-3 flex items-center justify-center">
                      <img
                        src={src}
                        alt={s.label}
                        className="object-contain w-[85%] h-[85%] transition"
                        onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
                      />
                    </div>
                    <div className="text-center text-sm font-semibold">{s.label}</div>
                  </button>
                );
              })}
            </div>

            {/* Dialogue box below sprites with matching prompt & colored sprite */}
            <div className="mt-6 max-w-3xl mx-auto">
              {(() => {
                const k = hoverKey ?? focusKey ?? ("place" as MenuKey);
                const s = menuSprites[k];
                return (
                  <DialogueBox
                    spriteSrc={s.color}
                    title={s.label}
                    lines={s.lines}
                  />
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* PLACE BET AREA (tabs) */}
      {phase === "placebet" && (
        <div className="min-h-screen">
          {/* Header */}
          <div
            className="relative min-h-[220px] flex items-end bg-cover bg-center"
            style={{ backgroundImage: `url(${placeBg})` }}
          >
            <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.4),rgba(0,0,0,0.85))]" />
            <div className="relative container mx-auto px-4 py-10">
              <div className="flex items-center gap-3 text-white/80 text-sm">
                <TrendingUp size={16} />
                <span>Best Bet NFL</span>
              </div>
              <h1 className="text-2xl md:text-3xl font-bold mt-2">Betting Simulator & True Odds Engine</h1>
              <p className="text-white/70 max-w-3xl mt-2">
                Simulate singles, parlays (now with team + player props mixed), or batch slips. See true odds (0.01% precision) and EV.
              </p>
              <div className="mt-4 flex gap-2">
                <button className="btn" onClick={() => setPhase("main")}>
                  <ArrowLeft size={16} className="mr-2" />
                  Back
                </button>
                <button className="btn" onClick={doRefresh} disabled={busy}>
                  <RefreshCw size={16} className="mr-2" />
                  Refresh weekly stats
                </button>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="container mx-auto px-4 py-8 grid md:grid-cols-3 gap-6">
            {/* Left tabs */}
            <div className="card h-fit">
              <div className="text-sm uppercase tracking-widest text-white/60 mb-3">Sections</div>
              <div className="grid gap-2">
                <button className={`btn ${tab === "single" ? "btn-primary" : ""}`} onClick={() => setTab("single")}>
                  Single / Moneyline / Spread / Player
                </button>
                <button className={`btn ${tab === "parlay" ? "btn-primary" : ""}`} onClick={() => setTab("parlay")}>
                  Parlay (Team + Player)
                </button>
                <button className={`btn ${tab === "batch" ? "btn-primary" : ""}`} onClick={() => setTab("batch")}>
                  Batch JSON
                </button>
              </div>
            </div>

            {/* Right panels (exclusive) */}
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
                        Implied: {pct01(impliedFromAmerican(((single as any).american_odds as number) ?? 0))}
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
                            value={Number((single as any).line ?? 0)}
                            onChange={(e) => setSingle({ ...(single as any), line: Number(e.target.value) } as any)}
                          />
                        </div>
                      )}

                      <div className="grid gap-2">
                        <label className="label">American Odds</label>
                        <input
                          className="input"
                          type="number"
                          value={Number((single as any).american_odds ?? 0)}
                          onChange={(e) => setSingle({ ...(single as any), american_odds: Number(e.target.value) } as any)}
                        />
                      </div>

                      <div className="grid gap-2">
                        <label className="label">Stake</label>
                        <input
                          className="input"
                          type="number"
                          value={Number((single as any).stake ?? 100)}
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
                        <input className="input" value={playerName} onChange={(e) => setPlayerName(e.target.value)} />
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

              {/* PARLAY (Mixed legs) */}
              {tab === "parlay" && (
                <div className="card">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-lg font-semibold">Parlay (Team + Player Props)</h2>
                    <button className="btn btn-primary" onClick={doParlay} disabled={busy}>
                      {busy ? "Evaluating..." : "Evaluate Parlay"}
                    </button>
                  </div>

                  <div className="grid gap-4">
                    {parlayLegs.map((leg, idx) => (
                      <div key={idx} className="grid grid-cols-1 gap-3 p-3 rounded-xl bg-black/40 border border-white/10">
                        {/* Leg type switch */}
                        <div className="flex items-center gap-2">
                          <label className="label">Leg Type</label>
                          <select
                            className="input w-44"
                            value={leg.leg_type}
                            onChange={(e) => {
                              const v = e.target.value as "team" | "player";
                              setParlay((p: any) => {
                                const next = { ...p };
                                const copy = [...parlayLegs];
                                copy[idx] =
                                  v === "team"
                                    ? { leg_type: "team", home_team: "", away_team: "", market: "moneyline", pick: "home", line: 0, american_odds: 0 }
                                    : { leg_type: "player", player: "", prop_kind: "wr_rec_yards", side: "over", line: 0, opponent: "", american_odds: 0 };
                                next.legs = copy;
                                return next;
                              });
                            }}
                          >
                            <option value="team">Team</option>
                            <option value="player">Player</option>
                          </select>
                        </div>

                        {/* TEAM LEG FIELDS */}
                        {leg.leg_type === "team" && (
                          <div className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
                            <div>
                              <label className="label">Home</label>
                              <input
                                className="input"
                                value={(leg as any).home_team ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setParlay((p: any) => {
                                    const next = { ...p };
                                    const copy = [...parlayLegs];
                                    (copy[idx] as any).home_team = v;
                                    next.legs = copy;
                                    return next;
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
                                  setParlay((p: any) => {
                                    const next = { ...p };
                                    const copy = [...parlayLegs];
                                    (copy[idx] as any).away_team = v;
                                    next.legs = copy;
                                    return next;
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
                                  const v = e.target.value as "moneyline" | "spread";
                                  setParlay((p: any) => {
                                    const next = { ...p };
                                    const copy = [...parlayLegs];
                                    (copy[idx] as any).market = v;
                                    next.legs = copy;
                                    return next;
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
                                  const v = e.target.value as "home" | "away";
                                  setParlay((p: any) => {
                                    const next = { ...p };
                                    const copy = [...parlayLegs];
                                    (copy[idx] as any).pick = v;
                                    next.legs = copy;
                                    return next;
                                  });
                                }}
                              >
                                <option value="home">home</option>
                                <option value="away">away</option>
                              </select>
                            </div>
                            {(leg as any).market === "spread" && (
                              <div>
                                <label className="label">Line</label>
                                <input
                                  className="input"
                                  type="number"
                                  value={Number((leg as any).line ?? 0)}
                                  onChange={(e) => {
                                    const v = Number(e.target.value);
                                    setParlay((p: any) => {
                                      const next = { ...p };
                                      const copy = [...parlayLegs];
                                      (copy[idx] as any).line = v;
                                      next.legs = copy;
                                      return next;
                                    });
                                  }}
                                />
                              </div>
                            )}
                            <div>
                              <label className="label">American Odds</label>
                              <input
                                className="input"
                                type="number"
                                value={Number((leg as any).american_odds ?? 0)}
                                onChange={(e) => {
                                  const v = Number(e.target.value);
                                  setParlay((p: any) => {
                                    const next = { ...p };
                                    const copy = [...parlayLegs];
                                    (copy[idx] as any).american_odds = v;
                                    next.legs = copy;
                                    return next;
                                  });
                                }}
                              />
                            </div>
                          </div>
                        )}

                        {/* PLAYER LEG FIELDS */}
                        {leg.leg_type === "player" && (
                          <div className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
                            <div className="md:col-span-2">
                              <label className="label">Player</label>
                              <input
                                className="input"
                                value={(leg as any).player ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setParlay((p: any) => {
                                    const next = { ...p };
                                    const copy = [...parlayLegs];
                                    (copy[idx] as any).player = v;
                                    next.legs = copy;
                                    return next;
                                  });
                                }}
                              />
                            </div>
                            <div>
                              <label className="label">Prop Kind</label>
                              <select
                                className="input"
                                value={(leg as any).prop_kind ?? "wr_rec_yards"}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setParlay((p: any) => {
                                    const next = { ...p };
                                    const copy = [...parlayLegs];
                                    (copy[idx] as any).prop_kind = v;
                                    next.legs = copy;
                                    return next;
                                  });
                                }}
                              >
                                {Object.values(PROP_KIND_BY_LABEL).map((k) => (
                                  <option key={k} value={k}>{k}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="label">Side</label>
                              <select
                                className="input"
                                value={(leg as any).side ?? "over"}
                                onChange={(e) => {
                                  const v = e.target.value as "over" | "under";
                                  setParlay((p: any) => {
                                    const next = { ...p };
                                    const copy = [...parlayLegs];
                                    (copy[idx] as any).side = v;
                                    next.legs = copy;
                                    return next;
                                  });
                                }}
                              >
                                <option value="over">over</option>
                                <option value="under">under</option>
                              </select>
                            </div>
                            <div>
                              <label className="label">Line</label>
                              <input
                                className="input"
                                type="number"
                                value={Number((leg as any).line ?? 0)}
                                onChange={(e) => {
                                  const v = Number(e.target.value);
                                  setParlay((p: any) => {
                                    const next = { ...p };
                                    const copy = [...parlayLegs];
                                    (copy[idx] as any).line = v;
                                    next.legs = copy;
                                    return next;
                                  });
                                }}
                              />
                            </div>
                            <div>
                              <label className="label">Opponent (abbr)</label>
                              <input
                                className="input"
                                value={(leg as any).opponent ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setParlay((p: any) => {
                                    const next = { ...p };
                                    const copy = [...parlayLegs];
                                    (copy[idx] as any).opponent = v;
                                    next.legs = copy;
                                    return next;
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
                                  setParlay((p: any) => {
                                    const next = { ...p };
                                    const copy = [...parlayLegs];
                                    (copy[idx] as any).american_odds = v;
                                    next.legs = copy;
                                    return next;
                                  });
                                }}
                              />
                            </div>
                          </div>
                        )}

                        <div className="flex justify-between">
                          <button
                            className="btn"
                            onClick={() =>
                              setParlay((p: any) => {
                                const next = { ...p };
                                const copy = [...parlayLegs];
                                copy.splice(idx + 1, 0, { leg_type: leg.leg_type } as any);
                                next.legs = copy;
                                return next;
                              })
                            }
                          >
                            + Duplicate below
                          </button>
                          <button
                            className="btn btn-secondary"
                            onClick={() =>
                              setParlay((p: any) => {
                                const next = { ...p };
                                next.legs = parlayLegs.filter((_, i) => i !== idx);
                                return next;
                              })
                            }
                          >
                            Remove leg
                          </button>
                        </div>
                      </div>
                    ))}

                    <div className="flex items-center justify-between">
                      <div className="flex gap-2">
                        <button
                          className="btn"
                          onClick={() =>
                            setParlay((p: any) => {
                              const next = { ...p };
                              next.legs = [
                                ...parlayLegs,
                                { leg_type: "team", home_team: "NYJ", away_team: "BUF", market: "moneyline", pick: "home", american_odds: -110 },
                              ];
                              return next;
                            })
                          }
                        >
                          + Add Team leg
                        </button>
                        <button
                          className="btn"
                          onClick={() =>
                            setParlay((p: any) => {
                              const next = { ...p };
                              next.legs = [
                                ...parlayLegs,
                                { leg_type: "player", player: "", prop_kind: "wr_rec_yards", side: "over", line: 0, opponent: "", american_odds: -110 },
                              ];
                              return next;
                            })
                          }
                        >
                          + Add Player leg
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <label className="label">Stake</label>
                        <input
                          className="input w-28"
                          type="number"
                          value={Number(parlay?.stake ?? 10)}
                          onChange={(e) =>
                            setParlay((p: any) => ({ ...p, stake: Number(e.target.value) }))
                          }
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* BATCH */}
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
                    Tip: Include both team and player legs in <code>parlays[].legs</code> using <code>"market": "moneyline" | "spread" | "prop"</code>.
                  </div>
                </div>
              )}

              {/* DIALOGUE SUMMARY (above results; appears when result exists) */}
              {result && <DialogueSummary result={result} />}

              {/* Collapsible RESULTS */}
              <div className="card">
                <button
                  className="w-full flex items-center justify-between mb-2 text-left"
                  onClick={() => setShowResultDetails((v) => !v)}
                >
                  <div className="flex items-center gap-2">
                    <Info size={16} />
                    <h2 className="text-lg font-semibold">Raw Calculation Details</h2>
                  </div>
                  {showResultDetails ? <ChevronDown /> : <ChevronRight />}
                </button>
                {showResultDetails && (
                  <pre className="bg-black/50 p-3 rounded overflow-auto text-sm">
                    {err ? `Error: ${err}` : JSON.stringify(result, null, 2)}
                  </pre>
                )}
                {!showResultDetails && (
                  <div className="text-xs text-white/60">
                    Click to expand raw JSON results (probability inputs, payouts, EV breakdowns).
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MY STATS (stub screen) */}
      {phase === "stats" && (
        <div
          className="min-h-screen relative flex items-end bg-cover bg-center"
          style={{ backgroundImage: `url(/assets/bg/bg-stats.png)` }}
        >
          <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.4),rgba(0,0,0,0.85))]" />
          <div className="relative container mx-auto px-4 py-10">
            <div className="flex items-center gap-3 text-white/80 text-sm">
              <TrendingUp size={16} />
              <span>Best Bet NFL</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold mt-2">My Stats</h1>
            <p className="text-white/70 max-w-3xl mt-2">
              Session totals, hit rates, EV and profit tracking (coming soon).
            </p>
            <div className="mt-4">
              <button className="btn" onClick={() => setPhase("main")}>
                <ArrowLeft size={16} className="mr-2" />
                Back
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SETTINGS */}
      {phase === "settings" && (
        <div
          className="min-h-screen relative flex items-end bg-cover bg-center"
          style={{ backgroundImage: `url(/assets/bg/bg-settings.png)` }}
        >
          <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.4),rgba(0,0,0,0.85))]" />
          <div className="relative container mx-auto px-4 py-10">
            <div className="flex items-center gap-3 text-white/80 text-sm">
              <TrendingUp size={16} />
              <span>Best Bet NFL</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold mt-2">Settings</h1>
            <p className="text-white/70 max-w-3xl mt-2">
              Refresh weekly stats and tweak preferences.
            </p>
            <div className="mt-4 flex gap-2">
              <button className="btn" onClick={() => setPhase("main")}>
                <ArrowLeft size={16} className="mr-2" />
                Back
              </button>
              <button className="btn" onClick={doRefresh} disabled={busy}>
                <RefreshCw size={16} className="mr-2" />
                Refresh weekly stats
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}













