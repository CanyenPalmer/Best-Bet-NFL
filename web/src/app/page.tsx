"use client";

import { useState } from "react";
import { api, SingleReq, ParlayReq } from "@/lib/api";
import { RefreshCw, Percent, Plus, Minus } from "lucide-react";

type Tab = "single" | "parlay" | "batch";

export default function Page() {
  const [tab, setTab] = useState<Tab>("single");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
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

        {/* Forms */}
        <div className="md:col-span-2 grid gap-6">
          {tab === "single" && <SingleForm value={single} onChange={setSingle} onSubmit={() => run(() => api.single(single))} loading={loading} />}
          {tab === "parlay" && <ParlayForm value={parlay} onChange={setParlay} onSubmit={() => run(() => api.parlay(parlay))} loading={loading} />}
          {tab === "batch" && <BatchBox text={batchText} setText={setBatchText} onSubmit={() => run(() => api.batch(JSON.parse(batchText)))} loading={loading} />}
          <ResultPanel loading={loading} error={error} result={result} />
        </div>
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
            <Field label="Prop Kind" value={value.prop_kind || ""} onChange={v => onChange({ ...value, prop_kind: v })} placeholder="qb_pass_yards, wr_rec_yards, rb_rush_tds..." />
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
                  <Field label="Prop Kind" value={leg.prop_kind || ""} onChange={v => updateLeg(i, { prop_kind: v })} placeholder="qb_pass_yards..." />
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

function ResultPanel({ loading, error, result }: { loading: boolean; error: string | null; result: any }) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <Percent className="w-4 h-4" />
        <div className="text-lg font-semibold">Results</div>
      </div>
      {loading && <div className="text-white/60">Running...</div>}
      {error && <div className="text-red-300">{error}</div>}
      {!loading && !error && result && (
        <pre className="text-sm whitespace-pre-wrap">{JSON.stringify(result, null, 2)}</pre>
      )}
      {!loading && !error && !result && (
        <div className="text-white/60">Submit a bet or parlay to see results.</div>
      )}
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

