# src/service/contracts.py
from __future__ import annotations
from typing import Literal, TypedDict, List, Dict, Any

Market = Literal["prop", "moneyline", "spread", "total", "team_total"]
Side = Literal["over", "under", "home", "away"]

class SingleBetReq(TypedDict, total=False):
    market: Market
    stake: float
    odds_format: Literal["american"]
    odds: int
    team: str
    opponent: str
    player: str
    opponent_team: str
    # prop kinds (examples):
    # qb_pass_yards, qb_pass_tds, qb_pass_attempts, qb_completions, qb_rush_tds
    # rb_rush_yards, rb_rush_tds, rb_longest_run
    # wr_rec_yards, wr_receptions, wr_longest_catch, wr_rec_tds
    # te_rec_yards, te_receptions, te_longest_catch, te_rec_tds
    # k_fg_made
    prop_kind: str
    side: Side
    line: float
    spread_line: float
    total_line: float
    team_total_line: float

class SingleBetResp(TypedDict):
    label: str
    market: Market
    probability: float
    probability_pct: str
    payout_if_win: float
    stake: float
    expected_value: float
    snapshot: Dict[str, Any]
    debug: Dict[str, Any]
    summary: str

class ParlayReq(TypedDict):
    stake: float
    legs: List[SingleBetReq]

class ParlayLeg(TypedDict):
    label: str
    market: Market
    probability: float
    probability_pct: str
    odds: int
    summary: str

class ParlayResp(TypedDict):
    stake: float
    legs: List[ParlayLeg]
    parlay_probability_independent: float
    parlay_probability_independent_pct: str
    correlation_note: str
    combined_decimal_odds: float
    payout_if_win: float
    expected_value: float

class BatchReq(TypedDict):
    singles: List[SingleBetReq]
    parlays: List[ParlayReq]

class BatchResp(TypedDict):
    singles: List[SingleBetResp]
    parlays: List[ParlayResp]
