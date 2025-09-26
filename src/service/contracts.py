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
    # team
    team: str
    opponent: str
    # player prop
    player: str
    opponent_team: str
    prop_kind: str
    side: Side
    line: float
    # spread
    spread_line: float

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
    odds: int

class ParlayLeg(TypedDict, total=False):
    market: Market
    odds_format: Literal["american"]
    odds: int
    team: str
    opponent: str
    player: str
    opponent_team: str
    prop_kind: str
    side: Side
    line: float
    spread_line: float

class ParlayLegResp(TypedDict):
    label: str
    probability: float
    probability_pct: str
    odds: int
    debug: Dict[str, Any]

class ParlayReq(TypedDict):
    stake: float
    legs: List[ParlayLeg]

class ParlayResp(TypedDict):
    stake: float
    legs: List[ParlayLegResp]
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

__all__ = [
    "Market", "Side",
    "SingleBetReq", "SingleBetResp",
    "ParlayLeg", "ParlayLegResp", "ParlayReq", "ParlayResp",
    "BatchReq", "BatchResp",
]

