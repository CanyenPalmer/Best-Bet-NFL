# src/service/contracts.py
"""
Contracts (schemas) for Best Bet NFL.
- TypedDicts keep the service layer lightweight and compatible with dict-based usage.
- We can add Pydantic request/response models later for FastAPI validation.
"""

from __future__ import annotations
from typing import Literal, TypedDict, List, Dict, Any

# ---- Enums ----
Market = Literal["prop", "moneyline", "spread", "total", "team_total"]
Side = Literal["over", "under", "home", "away"]

# ---- Singles ----
class SingleBetReq(TypedDict, total=False):
    """Input for a single market evaluation."""
    market: Market
    stake: float
    odds_format: Literal["american"]  # reserved for future formats
    odds: int

    # team markets
    team: str
    opponent: str

    # player prop markets
    player: str
    opponent_team: str
    prop_kind: str   # e.g., qb_pass_yards, wr_rec_yards, rb_rush_tds
    side: Side       # over/under for props
    line: float

    # spread markets
    spread_line: float

class SingleBetResp(TypedDict):
    """Output for a single market evaluation."""
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

# ---- Parlays ----
class ParlayLeg(TypedDict, total=False):
    """A single leg within a parlay."""
    market: Market
    odds_format: Literal["american"]
    odds: int

    # team leg
    team: str
    opponent: str

    # player prop leg
    player: str
    opponent_team: str
    prop_kind: str
    side: Side
    line: float

    # spread leg
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

# ---- Batch ----
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
