# src/service/api.py
from __future__ import annotations
from typing import List, Dict, Any
from .contracts import (
    SingleBetReq, SingleBetResp, ParlayReq, ParlayResp, ParlayLeg,
    BatchReq, BatchResp
)
from ..engine import nfl_bet_engine as engine

# --- helpers ---

def _pct(p: float) -> str:
    return f"{round(100.0 * max(0.0, min(1.0, float(p))), 2):.2f}%"

def _payout_from_american(stake: float, american_odds: int) -> float:
    if american_odds >= 0:
        return round(stake * (1 + american_odds / 100.0), 2)
    return round(stake * (1 + 100.0 / abs(american_odds)), 2)

def _decimal_from_american(odds: int) -> float:
    return 1 + (odds / 100.0 if odds > 0 else 100.0 / abs(odds))

# SDs for spread/total/team-total wrappers (transparent assumptions)
SD_DIFF, SD_TOTAL, SD_TEAM = 13.0, 18.0, 7.0

# --- public: refresh & snapshot (hook these to a UI button) ---

def refresh_data(seasons: list[int] | None = None) -> Dict[str, Any]:
    """Fetch latest weekly stats + rebuild rolling metrics. UI calls this via a 'Refresh' action."""
    return engine.refresh_data(seasons)

def get_snapshot() -> Dict[str, Any]:
    """Return freshness + config metadata for UI display."""
    return engine.get_snapshot()

# --- single evaluators ---

def _normalize_prop_kind(kind: str) -> str:
    k = (kind or "").lower().strip()
    if k.startswith("te_"):
        k = k.replace("te_", "wr_")  # TE props share WR metrics
    if k == "qb_rush_tds":
        k = "rb_rush_tds"
    return k

def evaluate_single(req: SingleBetReq) -> SingleBetResp:
    market = req["market"]
    stake = float(req.get("stake", 0.0))
    odds = int(req.get("odds", -110))

    if market == "prop":
        kind = _normalize_prop_kind(req.get("prop_kind", ""))
        res = engine.compute_prop_probability(
            player=req.get("player", ""),
            opponent_team=req.get("opponent_team") or req.get("opponent") or "",
            kind=kind,
            side=req.get("side", "over"),
            line=float(req.get("line", 0.0))
        )
        p = float(res["p_hit"]) if res else 0.0
        label = f"{req.get('player','')} {req.get('side','').upper()} {req.get('line','')} {kind} vs {req.get('opponent') or req.get('opponent_team','')}".strip()
        snapshot, debug = res.get("snapshot", {}), res.get("debug", {})

    elif market == "moneyline":
        ml = engine.compute_moneyline(req.get("team", ""), req.get("opponent", ""))
        p = float(ml["p_win"]) if ml else 0.0
        label = f"{req.get('team','')} ML vs {req.get('opponent','')}"
        snapshot = ml.get("snapshot", {})
        debug = {
            "expected_points_for": ml["expected_points_for"],
            "expected_points_against": ml["expected_points_against"]
        }

    elif market == "spread":
        ml = engine.compute_moneyline(req.get("team", ""), req.get("opponent", ""))
        mu_diff = float(ml["expected_points_for"]) - float(ml["expected_points_against"])
        line, side = float(req.get("spread_line", 0.0)), req.get("side", "home")
        p = 1.0 - engine._norm_cdf(line, mu_diff, SD_DIFF) if side == "home" else engine._norm_cdf(line, mu_diff, SD_DIFF)  # type: ignore
        label = f"{req.get('team','')} {line:+g} vs {req.get('opponent','')}"
        snapshot, debug = ml.get("snapshot", {}), {"mu_diff": mu_diff, "sd_diff": SD_DIFF, "line": line, "side": side}

    elif market == "total":
        ml = engine.compute_moneyline(req.get("team", ""), req.get("opponent", ""))
        mu_total = float(ml["expected_points_for"]) + float(ml["expected_points_against"])
        line, side = float(req.get("total_line", 0.0)), req.get("side", "over")
        p_over = 1.0 - engine._norm_cdf(line, mu_total, SD_TOTAL)  # type: ignore
        p = p_over if side == "over" else 1.0 - p_over
        label = f"{side.upper()} {line} ({req.get('team','')} vs {req.get('opponent','')})"
        snapshot, debug = ml.get("snapshot", {}), {"mu_total": mu_total, "sd_total": SD_TOTAL, "line": line, "side": side}

    elif market == "team_total":
        ml = engine.compute_moneyline(req.get("team", ""), req.get("opponent", ""))
        mu_team = float(ml["expected_points_for"])
        line, side = float(req.get("team_total_line", 0.0)), req.get("side", "over")
        p_over = 1.0 - engine._norm_cdf(line, mu_team, SD_TEAM)  # type: ignore
        p = p_over if side == "over" else 1.0 - p_over
        label = f"{req.get('team','')} {side.upper()} {line}"
        snapshot, debug = ml.get("snapshot", {}), {"mu_team": mu_team, "sd_team": SD_TEAM, "line": line, "side": side}

    else:
        raise ValueError(f"Unsupported market: {market}")

    payout = _payout_from_american(stake, odds)
    profit_if_win = payout - stake
    ev = p * profit_if_win - (1 - p) * stake

    return {
        "label": label,
        "market": market,
        "probability": round(p, 6),
        "probability_pct": _pct(p),                 # <- percent-first for UI
        "payout_if_win": round(payout, 2),
        "stake": round(stake, 2),
        "expected_value": round(ev, 2),
        "snapshot": snapshot,
        "debug": debug,
        "summary": f"Probability: {_pct(p)}. Stake ${stake:.2f} → Payout if win ${payout:.2f}. Money does not affect probability."
    }

# --- parlay ---

def evaluate_parlay(req: ParlayReq) -> ParlayResp:
    legs_out: List[ParlayLeg] = []
    p_prod, dec_prod = 1.0, 1.0

    for leg in req["legs"]:
        single = evaluate_single(leg)
        p_prod *= single["probability"]
        dec_prod *= _decimal_from_american(int(leg.get("odds", -110)))
        legs_out.append({
            "label": single["label"],
            "market": leg["market"],
            "probability": single["probability"],
            "probability_pct": single["probability_pct"],
            "odds": int(leg.get("odds", -110)),
            "summary": single["summary"],
        })

    payout = round(req["stake"] * dec_prod, 2)
    profit_if_win = payout - req["stake"]
    ev = p_prod * profit_if_win - (1 - p_prod) * req["stake"]

    return {
        "stake": round(req["stake"], 2),
        "legs": legs_out,
        "parlay_probability_independent": round(p_prod, 6),
        "parlay_probability_independent_pct": _pct(p_prod),
        "correlation_note": "Assumes independent legs. Player stats from same team/market may be correlated.",
        "combined_decimal_odds": round(dec_prod, 4),
        "payout_if_win": payout,
        "expected_value": round(ev, 2),
    }

# --- batch ---

def evaluate_batch(req: BatchReq) -> BatchResp:
    return {
        "singles": [evaluate_single(s) for s in req.get("singles", [])],
        "parlays": [evaluate_parlay(p) for p in req.get("parlays", [])]
    }

