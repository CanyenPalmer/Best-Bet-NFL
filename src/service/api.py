# src/service/api.py
from __future__ import annotations
from typing import List, Dict, Any
from .contracts import (
    SingleBetReq, SingleBetResp, ParlayReq, ParlayResp, ParlayLeg, ParlayLegResp,
    BatchReq, BatchResp
)
from ..engine import nfl_bet_engine as engine

# --- helpers ---
def _pct(p: float) -> str:
    return f"{round(100.0 * max(0.0, min(1.0, float(p))), 2):.2f}%"

def _decimal_from_american(american_odds: int) -> float:
    ao = int(american_odds)
    return 1.0 + (ao / 100.0 if ao >= 0 else 100.0 / abs(ao))

def _payout_from_american(stake: float, american_odds: int) -> float:
    dec = _decimal_from_american(american_odds)
    return stake * (dec - 1.0)

def _ev(stake: float, p: float, american_odds: int) -> float:
    dec = _decimal_from_american(american_odds)
    return p * stake * (dec - 1.0) - (1.0 - p) * stake

# --- public wrappers ---
def refresh_data() -> Dict[str, Any]:
    return engine.refresh_data()

def get_snapshot() -> Dict[str, Any]:
    return engine.get_snapshot()

# --- core evaluators ---
def evaluate_single(req: SingleBetReq) -> SingleBetResp:
    market = req.get("market", "prop")
    stake = float(req.get("stake", 0.0))
    american_odds = int(req.get("odds", -110))

    label = ""
    probability = 0.0
    snapshot: Dict[str, Any] = {}
    debug: Dict[str, Any] = {}

    if market == "prop":
        player = req.get("player", "")
        opponent_team = req.get("opponent_team") or req.get("opponent") or ""
        prop_kind = str(req.get("prop_kind", "")).lower()
        side = str(req.get("side", "over")).lower()
        line = float(req.get("line", 0.0))
        res = engine.compute_prop_probability(player, opponent_team, prop_kind, side, line)
        probability = float(res["p_hit"])
        snapshot = res.get("snapshot", {})
        debug = res.get("debug", {})
        label = f"{player} {prop_kind.replace('_', ' ')} {side} {line}"

    elif market == "moneyline":
        team = req.get("team", "")
        opponent = req.get("opponent", "")
        res = engine.compute_moneyline(team=team, opponent=opponent)
        probability = float(res["p_win"])
        snapshot = res.get("snapshot", {})
        debug = {
            "expected_points_for": res.get("expected_points_for"),
            "expected_points_against": res.get("expected_points_against")
        }
        label = f"{team} moneyline vs {opponent}"

    elif market == "spread":
        team = req.get("team", "")
        opponent = req.get("opponent", "")
        spread_line = float(req.get("spread_line", 0.0))
        if hasattr(engine, "compute_spread_probability"):
            res = engine.compute_spread_probability(team=team, opponent=opponent, spread_line=spread_line)
            probability = float(res["p_cover"])
            snapshot = res.get("snapshot", {})
            debug = res.get("debug", {})
        else:
            probability = 0.5
            snapshot = engine.get_snapshot()
            debug = {"note": "compute_spread_probability not available; using neutral 50%"}
        sign = "-" if spread_line < 0 else "+"
        label = f"{team} {sign}{abs(spread_line)} vs {opponent}"

    else:
        probability = 0.5
        snapshot = engine.get_snapshot()
        label = f"{req.get('market', 'unknown')} market (prototype)"
        debug = {"note": "Market not implemented; using neutral 50%."}

    payout = _payout_from_american(stake, american_odds)
    ev = _ev(stake, probability, american_odds)
    return {
        "label": label,
        "market": market,  # type: ignore
        "probability": round(probability, 6),
        "probability_pct": _pct(probability),
        "payout_if_win": round(payout, 2),
        "stake": round(stake, 2),
        "expected_value": round(ev, 2),
        "snapshot": snapshot,
        "debug": debug,
        "summary": f"{label} has {round(probability*100, 2):.2f}% hit chance; EV ${round(ev,2):.2f} at odds {american_odds}",
        "odds": american_odds
    }

def _evaluate_parlay_leg(leg: ParlayLeg) -> ParlayLegResp:
    sreq: SingleBetReq = dict(leg)  # type: ignore
    sreq["stake"] = 0.0
    sresp = evaluate_single(sreq)
    return {
        "label": sresp["label"],
        "probability": sresp["probability"],
        "probability_pct": sresp["probability_pct"],
        "odds": int(leg.get("odds", -110)),
        "debug": sresp["debug"],
    }

def evaluate_parlay(req: ParlayReq) -> ParlayResp:
    stake = float(req.get("stake", 0.0))
    leg_resps: List[ParlayLegResp] = [_evaluate_parlay_leg(leg) for leg in req.get("legs", [])]
    p_product = 1.0
    dec_prod = 1.0
    for lr in leg_resps:
        p_product *= float(lr["probability"])
        dec_prod *= _decimal_from_american(int(lr["odds"]))
    payout = stake * (dec_prod - 1.0)
    ev = p_product * payout - (1.0 - p_product) * stake

    return {
        "stake": round(stake, 2),
        "legs": leg_resps,
        "parlay_probability_independent": round(p_product, 6),
        "parlay_probability_independent_pct": _pct(p_product),
        "correlation_note": "Assumes independent legs. Same-team/player markets may be correlated.",
        "combined_decimal_odds": round(dec_prod, 4),
        "payout_if_win": round(payout, 2),
        "expected_value": round(ev, 2),
    }

def evaluate_batch(req: BatchReq) -> BatchResp:
    singles = [evaluate_single(s) for s in req.get("singles", [])]
    parlays = [evaluate_parlay(p) for p in req.get("parlays", [])]
    return {"singles": singles, "parlays": parlays}

# --- suggestions (added) ---
def list_players(prefix: str = "", limit: int = 50) -> Dict[str, Any]:
    try:
        players = engine.list_players(prefix=prefix, limit=limit)
        return {"players": players}
    except Exception as e:
        return {"players": [], "error": str(e)}

def list_teams(prefix: str = "", limit: int = 50) -> Dict[str, Any]:
    try:
        teams = engine.list_teams()
        if prefix:
            p = prefix.strip().upper()
            teams = [t for t in teams if t.startswith(p)]
        return {"teams": teams[:limit]}
    except Exception as e:
        return {"teams": [], "error": str(e)}

def list_prop_kinds() -> Dict[str, Any]:
    try:
        kinds = (
            engine.list_prop_kinds()
            if hasattr(engine, "list_prop_kinds")
            else sorted(list(engine._METRIC_MAP.keys()))
        )
        return {"prop_kinds": kinds}
    except Exception as e:
        return {"prop_kinds": [], "error": str(e)}



