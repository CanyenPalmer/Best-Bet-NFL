# src/engine/nfl_bet_engine.py
from __future__ import annotations
import math

# --- Math helpers ---

def _norm_cdf(x: float, mu: float, sigma: float) -> float:
    """Normal CDF with mean mu and std sigma."""
    z = (x - mu) / max(1e-9, sigma)
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2)))

def poisson_sf(k_minus_1: float, lam: float) -> float:
    """P(X > k-1) for Poisson(λ)."""
    k = int(math.floor(k_minus_1))
    term = math.exp(-lam)
    cdf = term
    for i in range(1, k + 1):
        term *= lam / i
        cdf += term
    return max(0.0, 1.0 - cdf)

# --- Probability stubs (replace with nfl_data_py ETL later) ---

def compute_prop_probability(player: str, opponent_team: str, kind: str,
                             side: str, line: float) -> dict:
    """Stub for player prop probability (replace with ETL-based logic)."""
    # For now: return 50% with debug info
    return {
        "p_hit": 0.5,
        "snapshot": {"note": "stub"},
        "debug": {"kind": kind, "line": line, "side": side}
    }

def compute_moneyline(team: str, opponent: str) -> dict:
    """Stub for moneyline probability (replace with team-level model)."""
    return {
        "p_win": 0.5,
        "expected_points_for": 24.0,
        "expected_points_against": 23.0,
        "snapshot": {"note": "stub"}
    }
