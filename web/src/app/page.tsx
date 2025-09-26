"use client";

import { useMemo, useState } from "react";
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

export default function Page() {
  const [tab, setTab] = useState<Tab>("single");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnyResult>(null);
  const [error, setError] = useState<string | null>(null);

  const [single, setSingle] = useState<SingleReq>({
    market: "prop", stake: 50, odds: -110,
    player: "Patrick Mahomes", opponent_team: "BUF",
    prop_kind: "qb_pass_yards", side: "over", line: 275.5
  });

  const [parlay, setParlay] = useState<ParlayReq>({
    stake: 25,
    legs: [
      { market: "prop", player: "Travis Kelce", opponent_team: "BUF", prop_kind: "wr_rec_yards", side: "over", line: 74.5, stake: 0, odds: -105 },
      { market: "spread", team: "KC", opponent: "BUF", spread_line: -2.5, stake: 0, odds: -105 }
    ]
  });

  const [batchText, setBatchText] = useState<string>(JSON.stringify({
    singles: [single],
    parlays: [parlay]
  }, null, 2));

  async function run(fn: () => Promise<any>) {
    setError(null); setResult(null); setLoading(true);
    try { setResult(await fn()); }
    catch (e: any) { setError(e.message || String(e)); }
    finally { setLoading(false); }
  }

  return (
    <main className="min-h-screen bg-ink">
      {/* Top bar */}
      <div className="sticky top-0 z-10 backdrop-blur bg-ink/70 border-b border-white/10">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <div className="text-lg font-semibold">Best Bet NFL</div>
          <button className="btn btn-primary" onClick={() => run(api.refresh)} disabled={loading}>
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh Data
          </button>
        </div>
      </div>

      {/* Hero */}
      <div className="mx-auto max-w-6xl px-4 pt-8">
        <div className="hero">
          <div className="relative z-10 p-8 md:p-12">
            <div className="text-2xl md:text-3xl font-bold">Best Bet NFL</div>
            <p className="mt-2 text-white/80 max-w-2xl">
              Paste your book’s lines. Get <span className="font-semibold text-white">actual hit probabilities</span> for props, moneylines, spreads, and parlays—so you can bet with confidence.
            </p>
            <div className="mt-4 text-sm text-white/70 flex items-center gap-2">
              <Info className="w-4 h-4" />
              Data updates daily. Use <code className="bg-white/10 px-2 py-1 rounded">Refresh Data</code> for on-demand refresh.
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-6xl px-4 py-6 grid md:grid-cols-3 gap-6">
        {/* Menu */}
        <div className="card h-fit">
          <div className="text-sm uppercase tracking-widest text-white/60 mb-3">Main Menu</div>
          <div className="grid gap-2">
            <button className={`btn ${tab === "single" ? "btn-primary" : ""}`} onClick={() => setTab("single")}>Single / Moneyline / Spread</button>
            <button className={`btn ${tab === "parlay" ? "btn-primary" : ""}`} onClick={() => setTab("parlay")}>Parlay</button>
            <button className={`btn ${tab === "batch" ? "btn-primary" : ""}`} onClick={() => setTab("batch")}>Batch JSON</button>
          </div>
          <div className="mt-4 text-xs text-white/60">
            Provide your book’s lines → we return an <span className="font-semibold text-white">actual probability</span> so you can bet with confidence.
          </div>
        </div>

        {/* Forms + Results */}
        <div className="md:col-span-2 grid gap-6">
          {tab === "single" && <SingleForm value={single} onChange={setSingle} onSubmit={() => run(() => api.single(single))} loading={loading} />}
          {tab === "parlay" && <ParlayForm value={parlay} onChange={setParlay} onSubmit={() => run(() => api.parlay(parlay))} loading={loading} />}
          {tab === "batch" && <BatchBox text={batchText} setText={setBatchText} onSubmit={() => run(() => api.batch(JSON.parse(batchText)))} loading={loading} />}
          <ResultPanel loading={loading} error={error} result={result} />
        </div>
      </div>

      <div className="footer">
        © {new Date().getFullYear()} Best Bet NFL — Educational use only. Not financial advice.
      </div>
    </main>
  );
}

function SingleForm({ value, onChange, onSubmit, loading }: {
  value: SingleReq, onChange: (v: SingleReq) => void, onSubmit: () => void, loading: boolean
}) {
  const isProp = value.market === "prop";
  const isML = value.market === "moneyline";
  const isSpread = value.market === "spread";

  // common prop kinds we support in backend
  const propKinds = [
    "qb_pass_yards","qb_pass_tds","qb_completions","qb_pass_attempts",
    "rb_rush_yards","rb_rush_tds","rb_longest_run",
    "wr_rec_yards","wr_receptions","wr_longest_catch","wr_rec_tds",
    "te_rec_yards","te_receptions","te_longest_catch","te_rec_tds",
    "k_fg_made"
  ];

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div className="text-lg font-semibold">Single Bet</div>
        <select
          className="input w-auto"
          value={value.market}
          onChange={e => onChange({ ...value, market: e.target.value as any })}
        >
          <option value="prop">Prop</option>
          <option value="moneyline">Moneyline</option>
          <option value="spread">Spread</option>
        </select>
      </div>

      {/* Common */}
      <div className="grid-cols-form">
        <Field label="Stake ($)" type="number" value={value.stake} onChange={v => onChange({ ...value, stake: Number(v) })} />
        <Field label="Odds (American)" type="number" value={value.odds} onChange={v => onChange({ ...value, odds: Number(v) })} />
      </div>

      {isProp && (
        <>
          <div className="grid-cols-form mt-4">
            <Field label="Player" value={value.player || ""} onChange={v => onChange({ ...value, player: v })} />
            <Field label="Opponent Team (e.g., BUF)" value={value.opponent_team || ""} onChange={v => onChange({ ...value, opponent_team: v })} />
          </div>
          <div className="grid-cols-form mt-4">
            <Field
              label="Prop Kind"
              as="select"
              value={value.prop_kind || ""}
              onChange={v => onChange({ ...value, prop_kind: v })}
              options={propKinds}
            />
            <Field label="Side" value={value.side || "over"} onChange={v => onChange({ ...value, side: v as any })} as="select" options={["over", "under"]} />
          </div>
          <div className="grid-cols-form mt-4">
            <Field label="Line" type="number" value={value.line || 0} onChange={v => onChange({ ...value, line: Number(v) })} />
          </div>
        </>
      )}

      {isML && (
        <div className="grid-cols-form mt-4">
          <Field label="Team" value={value.team || ""} onChange={v => onChange({ ...value, team: v })} />
          <Field label="Opponent" value={value.opponent || ""} onChange={v => onChange({ ...value, opponent: v })} />
        </div>
      )}

      {isSpread && (
        <>
          <div className="grid-cols-form mt-4">
            <Field label="Team" value={value.team || ""} onChange={v => onChange({ ...value, team: v })} />
            <Field label="Opponent" value={value.opponent || ""} onChange={v => onChange({ ...value, opponent: v })} />
          </div>
          <div className="grid-cols-form mt-4">
            <Field label="Spread Line" type="number" value={value.spread_line || 0} onChange={v => onChange({ ...value, spread_line: Number(v) })} />
          </div>
        </>
      )}

      <div className="mt-6">
        <button className="btn btn-primary" onClick={onSubmit} disabled={loading}>
          Evaluate
        </button>
      </div>
    </div>
  );
}

function ParlayForm({ value, onChange, onSubmit, loading }: {
  value: ParlayReq, onChange: (v: ParlayReq) => void, onSubmit: () => void, loading: boolean
}) {
  function updateLeg(i: number, patch: Partial<SingleReq>) {
    const legs = [...value.legs];
    legs[i] = { ...legs[i], ...patch };
    onChange({ ...value, legs });
  }
  function addLeg() {
    onChange({ ...value, legs: [...value.legs, { market: "prop", stake: 0, odds: -110 }] });
  }
  function removeLeg(i: number) {
    const legs = value.legs.filter((_, idx) => idx !== i);
    onChange({ ...value, legs });
  }

  const propKinds = [
    "qb_pass_yards","qb_pass_tds","qb_completions","qb_pass_attempts",
    "rb_rush_yards","rb_rush_tds","rb_longest_run",
    "wr_rec_yards","wr_receptions","wr_longest_catch","wr_rec_tds",
    "te_rec_yards","te_receptions","te_longest_catch","te_rec_tds",
    "k_fg_made"
  ];

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div className="text-lg font-semibold">Parlay</div>
        <button className="btn" onClick={addLeg}><Plus className="w-4 h-4 mr-2" />Add Leg</button>
      </div>

      <div className="grid-cols-form">
        <Field label="Stake ($)" type="number" value={value.stake} onChange={v => onChange({ ...value, stake: Number(v) })} />
      </div>

      <div className="mt-4 grid gap-4">
        {value.legs.map((leg, i) => (
          <div key={i} className="rounded-xl border border-white/10 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-medium text-white/80">Leg {i + 1}</div>
              <button className="btn" onClick={() => removeLeg(i)}><Minus className="w-4 h-4 mr-2" />Remove</button>
            </div>
            <div className="grid-cols-form">
              <Field label="Market" as="select" value={leg.market || "prop"} onChange={v => updateLeg(i, { market: v as any })} options={["prop", "moneyline", "spread"]} />
              <Field label="Odds (American)" type="number" value={leg.odds ?? -110} onChange={v => updateLeg(i, { odds: Number(v) })} />
            </div>

            {leg.market === "prop" && (
              <>
                <div className="grid-cols-form mt-3">
                  <Field label="Player" value={leg.player || ""} onChange={v => updateLeg(i, { player: v })} />
                  <Field label="Opponent Team" value={leg.opponent_team || ""} onChange={v => updateLeg(i, { opponent_team: v })} />
                </div>
                <div className="grid-cols-form mt-3">
                  <Field label="Prop Kind" as="select" value={leg.prop_kind || ""} onChange={v => updateLeg(i, { prop_kind: v })} options={propKinds} />
                  <Field label="Side" as="select" value={leg.side || "over"} onChange={v => updateLeg(i, { side: v as any })} options={["over", "under"]} />
                </div>
                <div className="grid-cols-form mt-3">
                  <Field label="Line" type="number" value={leg.line ?? 0} onChange={v => updateLeg(i, { line: Number(v) })} />
                </div>
              </>
            )}

            {leg.market === "moneyline" && (
              <div className="grid-cols-form mt-3">
                <Field label="Team" value={leg.team || ""} onChange={v => updateLeg(i, { team: v })} />
                <Field label="Opponent" value={leg.opponent || ""} onChange={v => updateLeg(i, { opponent: v })} />
              </div>
            )}

            {leg.market === "spread" && (
              <>
                <div className="grid-cols-form mt-3">
                  <Field label="Team" value={leg.team || ""} onChange={v => updateLeg(i, { team: v })} />
                  <Field label="Opponent" value={leg.opponent || ""} onChange={v => updateLeg(i, { opponent: v })} />
                </div>
                <div className="grid-cols-form mt-3">
                  <Field label="Spread Line" type="number" value={leg.spread_line ?? 0} onChange={v => updateLeg(i, { spread_line: Number(v) })} />
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6">
        <button className="btn btn-primary" onClick={onSubmit} disabled={loading}>Evaluate Parlay</button>
      </div>
    </div>
  );
}

function BatchBox({ text, setText, onSubmit, loading }: {
  text: string; setText: (v: string) => void; onSubmit: () => void; loading: boolean;
}) {
  return (
    <div className="card">
      <div className="text-lg font-semibold mb-3">Batch JSON</div>
      <textarea className="input h-56 font-mono" value={text} onChange={e => setText(e.target.value)} />
      <div className="mt-4">
        <button className="btn btn-primary" onClick={onSubmit} disabled={loading}>Evaluate Batch</button>
      </div>
    </div>
  );
}

function ResultPanel({ loading, error, result }: { loading: boolean; error: string | null; result: AnyResult }) {
  if (loading) {
    return <div className="card text-white/70">Running...</div>;
  }
  if (error) {
    return <div className="card text-red-300">{error}</div>;
  }
  if (!result) {
    return <div className="card text-white/60">Submit a bet or parlay to see results.</div>;
  }

  // Single
  if ("probability" in result && "probability_pct" in result) {
    return <SingleResult result={result} />;
  }
  // Parlay
  if ("parlay_probability_independent_pct" in result) {
    return <ParlayResult result={result as ParlayResp} />;
  }
  // Batch
  if ("singles" in result && "parlays" in result) {
    return <BatchResult result={result as { singles: SingleResp[]; parlays: ParlayResp[] }} />;
  }
  // Fallback
  return (
    <div className="card">
      <pre className="text-sm whitespace-pre-wrap">{JSON.stringify(result, null, 2)}</pre>
    </div>
  );
}

function SingleResult({ result }: { result: SingleResp }) {
  const implied = impliedFromAmerican((result as any).odds ?? -110);
  const actual = result.probability;
  const edge = actual - implied;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <div className="text-lg font-semibold">{result.label}</div>
        <div className="pill">
          <TrendingUp className="w-4 h-4" />
          {result.summary}
        </div>
      </div>

      <div className="grid md:grid-cols-4 gap-4 mt-4">
        <div className="stat">
          <div className="label">Actual Probability</div>
          <div className="value">{pct(actual)}</div>
          <div className="progress mt-2"><span style={{ width: pct(actual) }} /></div>
        </div>
        <div className="stat">
          <div className="label">Implied by Odds</div>
          <div className="value">{pct(implied)}</div>
          <div className="progress mt-2"><span style={{ width: pct(implied) }} /></div>
        </div>
        <div className="stat">
          <div className="label">Edge vs Implied</div>
          <div className="value" style={{ color: edge >= 0 ? "#c7f7c7" : "#ffb4b4" }}>
            {edge >= 0 ? "+" : ""}{(edge * 100).toFixed(2)}%
          </div>
        </div>
        <div className="stat">
          <div className="label">EV at Stake</div>
          <div className="value">${result.expected_value.toFixed(2)}</div>
          <div className="text-xs text-white/60 mt-1">Payout if Win: ${result.payout_if_win.toFixed(2)}</div>
        </div>
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer text-white/70">Details</summary>
        <pre className="mt-2 text-sm whitespace-pre-wrap">{JSON.stringify(result, null, 2)}</pre>
      </details>
    </div>
  );
}

function ParlayResult({ result }: { result: ParlayResp }) {
  return (
    <div className="card">
      <div className="text-lg font-semibold mb-2">Parlay</div>

      <div className="grid md:grid-cols-4 gap-4">
        <div className="stat">
          <div className="label">Parlay Probability</div>
          <div className="value">{result.parlay_probability_independent_pct}</div>
        </div>
        <div className="stat">
          <div className="label">Payout if Win</div>
          <div className="value">${result.payout_if_win.toFixed(2)}</div>
          <div className="text-xs text-white/60 mt-1">Stake: ${result.stake.toFixed(2)}</div>
        </div>
        <div className="stat">
          <div className="label">Expected Value</div>
          <div className="value">${result.expected_value.toFixed(2)}</div>
        </div>
        <div className="stat">
          <div className="label">Combined Decimal</div>
          <div className="value">{result.combined_decimal_odds.toFixed(3)}</div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-white/10">
        {result.legs.map((leg, i) => (
          <div key={i} className="p-4 border-b last:border-b-0 border-white/10">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium">{leg.label}</div>
              <div className="pill">
                <Percent className="w-4 h-4" />
                {leg.probability_pct} &nbsp; @ {leg.odds}
              </div>
            </div>
          </div>
        ))}
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer text-white/70">Details</summary>
        <pre className="mt-2 text-sm whitespace-pre-wrap">{JSON.stringify(result, null, 2)}</pre>
      </details>
    </div>
  );
}

function BatchResult({ result }: { result: { singles: SingleResp[]; parlays: ParlayResp[] } }) {
  return (
    <div className="card">
      <div className="text-lg font-semibold mb-2">Batch Results</div>
      <div className="text-white/70 text-sm mb-4">
        {result.singles.length} singles • {result.parlays.length} parlays
      </div>

      <div className="grid gap-4">
        {result.singles.map((s, i) => <SingleResult key={`s-${i}`} result={s} />)}
        {result.parlays.map((p, i) => <ParlayResult key={`p-${i}`} result={p} />)}
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer text-white/70">Raw JSON</summary>
        <pre className="mt-2 text-sm whitespace-pre-wrap">{JSON.stringify(result, null, 2)}</pre>
      </details>
    </div>
  );
}

function Field(props: {
  label: string; value: any; onChange: (v: any) => void;
  type?: string; as?: "input" | "select"; options?: string[]; placeholder?: string;
}) {
  const { label, value, onChange, type, as, options, placeholder } = props;
  if (as === "select") {
    return (
      <label className="block">
        <div className="label">{label}</div>
        <select className="input" value={value} onChange={e => onChange(e.target.value)}>
          <option value="" disabled>Select…</option>
          {options?.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    );
  }
  return (
    <label className="block">
      <div className="label">{label}</div>
      <input className="input" value={value} onChange={e => onChange(e.target.value)} type={type || "text"} placeholder={placeholder} />
    </label>
  );
}




