# src/engine/nfl_bet_engine.py
from __future__ import annotations
import math, os
from typing import Dict, Any, Tuple, Optional, List
import pandas as pd
import nfl_data_py as nfl

# -----------------------------
# Settings
# -----------------------------
HISTORY_GAMES = 30
ROOKIE_MIN_GAMES = 4

DEF_WEIGHT = 0.30
LONG_SIGMA_FLOOR = 10.0
SCORE_DIFF_SD = 13.0
TOTAL_SD = 18.0
TEAM_SD = 7.0

CURR_SEASON = int(os.getenv("SEASON", "2025"))
SEASONS_BACK = int(os.getenv("SEASONS_BACK", "2"))  # << default 2 to avoid cold-start timeouts
SEASONS = list(range(max(2009, CURR_SEASON - SEASONS_BACK + 1), CURR_SEASON + 1))

# -----------------------------
# Data caches
# -----------------------------
_PLAYERS: Optional[pd.DataFrame] = None  # player, team, pos, metric, mu, sd, n_games
_TEAM_ALLOWED: Optional[pd.DataFrame] = None  # team, metric, mu, sd, n_games
_SNAPSHOT: Dict[str, Any] = {}

# Metric mapping -> (weekly column, internal key)
_METRIC_MAP = {
    # QB
    "qb_pass_yards": ("passing_yards", "pass_yds"),
    "qb_pass_tds": ("passing_tds", "pass_tds"),
    "qb_completions": ("completions", "comp"),
    "qb_pass_attempts": ("attempts", "att"),

    # RB
    "rb_rush_yards": ("rushing_yards", "rush_yds"),
    "rb_rush_tds": ("rushing_tds", "rush_tds"),
    "rb_longest_run": ("rushing_yards", "long_rush_proxy"),

    # WR / TE (aliases: TE maps to WR keys)
    "wr_rec_yards": ("receiving_yards", "rec_yds"),
    "wr_receptions": ("receptions", "rec"),
    "wr_longest_catch": ("receiving_yards", "long_rec_proxy"),
    "wr_rec_tds": ("receiving_tds", "rec_tds"),

    "te_rec_yards": ("receiving_yards", "rec_yds"),
    "te_receptions": ("receptions", "rec"),
    "te_longest_catch": ("receiving_yards", "long_rec_proxy"),
    "te_rec_tds": ("receiving_tds", "rec_tds"),

    # Kicker
    "k_fg_made": ("field_goals_made", "fgm"),
}

# Team allowed mapping: opponent_team perspective
_TEAM_ALLOWED_KEYS = {
    "pass_yds": "passing_yards",
    "pass_tds": "passing_tds",
    "comp": "completions",
    "att": "attempts",
    "rush_yds": "rushing_yards",
    "rush_tds": "rushing_tds",
    "rec_yds": "receiving_yards",
    "rec": "receptions",
    "rec_tds": "receiving_tds",
    "long_rec_proxy": "receiving_yards",
    "long_rush_proxy": "rushing_yards",
    # points (computed below)
    "points_for": None,
    "points": None
}

# -----------------------------
# Math helpers
# -----------------------------
def _norm_cdf(x: float, mu: float, sigma: float) -> float:
    z = (x - mu) / max(1e-9, sigma)
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2)))

def _poisson_sf(k_minus_1: float, lam: float) -> float:
    k = int(math.floor(k_minus_1))
    term = math.exp(-lam)
    cdf = term
    for i in range(1, k + 1):
        term *= lam / i
        cdf += term
    return max(0.0, 1.0 - cdf)

def _logit_blend(p_model: float, p_prior: float, w_model: float = 0.6) -> float:
    def logit(p): return math.log(max(1e-6, p) / max(1e-6, 1 - p))
    def inv(z):  return 1.0 / (1.0 + math.exp(-z))
    return inv(w_model * logit(p_model) + (1 - w_model) * logit(p_prior))

# -----------------------------
# Core ETL
# -----------------------------
def _last_n_non_null(values: pd.Series, n: int) -> pd.Series:
    vv = values.dropna().astype(float)
    if vv.empty:
        return vv
    return vv.iloc[-n:]

def _player_roll(series_tail: pd.Series) -> Tuple[float, float, int]:
    n = len(series_tail)
    if n == 0:
        return 0.0, 0.0, 0
    mu = float(series_tail.mean())
    sd = float(series_tail.std(ddof=0)) if n > 1 else 0.0
    return mu, sd, n

def _compute_player_metrics(weekly: pd.DataFrame) -> pd.DataFrame:
    df = weekly.rename(columns={
        "player_name": "player",
        "recent_team": "team",
        "position": "pos"
    }).sort_values(["player", "season", "week"])

    # League baselines (for rookies <4 games)
    league_means, league_sds = {}, {}
    for _, (col, key) in _METRIC_MAP.items():
        if col not in df.columns:
            continue
        s = df[col].dropna().astype(float)
        league_means[key] = float(s.mean()) if not s.empty else 0.0
        league_sds[key] = float(s.std(ddof=0)) if not s.empty else 0.0

    rows = []
    for _, (col, key) in _METRIC_MAP.items():
        if col not in df.columns:
            continue
        for player, g in df.groupby("player", sort=False):
            tail = _last_n_non_null(g[col], HISTORY_GAMES)
            n = len(tail)
            if n < ROOKIE_MIN_GAMES:
                mu, sd, n_used = league_means[key], league_sds[key], 0
            else:
                mu, sd, n_used = _player_roll(tail)
            team = g["team"].dropna().iloc[-1] if not g["team"].dropna().empty else None
            pos = g["pos"].dropna().iloc[-1] if not g["pos"].dropna().empty else None
            rows.append({
                "player": player,
                "team": team,
                "pos": pos,
                "metric": key,
                "mu": mu,
                "sd": sd,
                "n_games": int(n_used if n >= ROOKIE_MIN_GAMES else n)
            })
    return pd.DataFrame(rows)

def _compute_team_allowed(weekly: pd.DataFrame) -> pd.DataFrame:
    df = weekly.copy().sort_values(["season", "week"])
    # Simple points proxy
    pass_td = df["passing_tds"] if "passing_tds" in df.columns else 0
    rush_td = df["rushing_tds"] if "rushing_tds" in df.columns else 0
    df["points_for_proxy"] = 6.0 * (pd.Series(pass_td).fillna(0) + pd.Series(rush_td).fillna(0))

    rows = []
    teams = sorted(set(df["recent_team"].dropna().unique()).union(set(df["opponent_team"].dropna().unique())))

    def allowed_stat(col: str, metric_key: str):
        for t in teams:
            g = df[df["opponent_team"] == t]
            tail = _last_n_non_null(g[col], HISTORY_GAMES) if col in g.columns else pd.Series([], dtype=float)
            mu, sd, n = _player_roll(tail)
            rows.append({"team": t, "metric": metric_key, "mu": mu if n>0 else 0.0, "sd": sd if n>1 else 0.0, "n_games": int(n)})

    for key, col in _TEAM_ALLOWED_KEYS.items():
        if key in ("points_for", "points"):
            continue
        if col is None:
            continue
        allowed_stat(col, key)

    # Points for / allowed
    for t in teams:
        g_for = df[df["recent_team"] == t]
        tail_for = _last_n_non_null(g_for["points_for_proxy"], HISTORY_GAMES)
        mu_for, sd_for, n_for = _player_roll(tail_for)
        rows.append({"team": t, "metric": "points_for", "mu": mu_for if n_for>0 else 21.0, "sd": sd_for if n_for>1 else 7.0, "n_games": int(n_for)})

        g_vs = df[df["opponent_team"] == t]
        tail_vs = _last_n_non_null(g_vs["points_for_proxy"], HISTORY_GAMES)
        mu_vs, sd_vs, n_vs = _player_roll(tail_vs)
        rows.append({"team": t, "metric": "points", "mu": mu_vs if n_vs>0 else 21.0, "sd": sd_vs if n_vs>1 else 7.0, "n_games": int(n_vs)})

    return pd.DataFrame(rows)

# -----------------------------
# Public refresh/load
# -----------------------------
def refresh_data(seasons: Optional[List[int]] = None) -> Dict[str, Any]:
    """
    Pull weekly NFL data for given seasons (default = last SEASONS_BACK),
    compute rolling player metrics (last 30) + rookie fallback,
    compute team 'allowed' context, store in-memory caches.
    """
    global _PLAYERS, _TEAM_ALLOWED, _SNAPSHOT
    use_seasons = seasons or SEASONS
    weekly = nfl.import_weekly_data(use_seasons)

    players = _compute_player_metrics(weekly)
    teams = _compute_team_allowed(weekly)

    _PLAYERS = players
    _TEAM_ALLOWED = teams
    _SNAPSHOT = {
        "snapshot_ts": pd.Timestamp.utcnow().isoformat(timespec="seconds"),
        "seasons": use_seasons,
        "player_rows": int(len(players)),
        "team_rows": int(len(teams)),
        "history_games": HISTORY_GAMES,
        "rookie_min_games": ROOKIE_MIN_GAMES
    }
    return {"status": "ok", **_SNAPSHOT}

def get_snapshot() -> Dict[str, Any]:
    return dict(_SNAPSHOT)

def _ensure_loaded():
    if _PLAYERS is None or _TEAM_ALLOWED is None:
        refresh_data()

# -----------------------------
# Lookups
# -----------------------------
def _player_stat(player: str, metric_key: str) -> Tuple[float, float, Optional[str], Optional[str], int]:
    _ensure_loaded()
    assert _PLAYERS is not None
    g = _PLAYERS[(_PLAYERS["player"].str.lower() == (player or "").lower()) &
                 (_PLAYERS["metric"] == metric_key)]
    if g.empty:
        g = _PLAYERS[(_PLAYERS["player"].str.lower().str.startswith((player or "").lower())) &
                     (_PLAYERS["metric"] == metric_key)]
    if g.empty:
        return 0.0, 0.0, None, None, 0
    row = g.iloc[-1]
    return float(row["mu"]), float(row["sd"]), row.get("team"), row.get("pos"), int(row.get("n_games", 0))

def _team_allowed_stat(team: str, metric_key: str) -> Tuple[float, float, int]:
    _ensure_loaded()
    assert _TEAM_ALLOWED is not None
    g = _TEAM_ALLOWED[(_TEAM_ALLOWED["team"].str.upper() == (team or "").upper()) &
                      (_TEAM_ALLOWED["metric"] == metric_key)]
    if g.empty:
        return 0.0, 0.0, 0
    row = g.iloc[-1]
    return float(row["mu"]), float(row["sd"]), int(row.get("n_games", 0))

# -----------------------------
# Public computations
# -----------------------------
def compute_prop_probability(player: str, opponent_team: str, kind: str,
                             side: str, line: float) -> Dict[str, Any]:
    """
    Returns: {p_hit, snapshot, debug}
    Supports QB passing TDs, rushing TDs (any position), and WR/TE receiving TDs.
    TE props are aliases of WR props (te_* -> wr_* keys where applicable).
    """
    kind = kind.lower()
    # Normalize TE aliases to WR keys
    if kind.startswith("te_"):
        kind = kind.replace("te_", "wr_")
    # Normalize QB rush TDs to RB rush TDs key
    if kind == "qb_rush_tds":
        kind = "rb_rush_tds"

    if kind not in _METRIC_MAP:
        raise ValueError(f"Unsupported prop kind: {kind}")

    col, key = _METRIC_MAP[kind]
    p_mu, p_sd, p_team, p_pos, p_games = _player_stat(player, key)
    o_mu, o_sd, o_games = _team_allowed_stat(opponent_team, key)

    prior = 0.5  # neutral prior

    if p_games == 0 and (p_mu == 0.0 and p_sd == 0.0):
        sd_used = max(10.0, o_sd)
        p_over = 1.0 - _norm_cdf(line, o_mu, sd_used)
        p = p_over if side == "over" else 1.0 - p_over
        return {"p_hit": float(p), "snapshot": get_snapshot(), "debug": {
            "metric": key, "mu_player": None, "sd_player": None, "n_player_games": 0,
            "mu_allowed": o_mu, "sd_allowed": o_sd, "n_allowed_games": o_games,
            "mu_blend": o_mu, "sd_used": sd_used, "team": None, "pos": None
        }}

    long_floor = key in ("long_rec_proxy", "long_rush_proxy")
    sd_player = max(p_sd, LONG_SIGMA_FLOOR) if long_floor else p_sd

    # Receiving share adjustment vs team pass allowed
    share = 1.0
    if key in ("rec", "rec_yds", "rec_tds", "long_rec_proxy"):
        share = 0.22

    mu_blend = (1 - DEF_WEIGHT) * p_mu + DEF_WEIGHT * (o_mu * share)
    var = ((1 - DEF_WEIGHT) ** 2) * (sd_player ** 2) + (DEF_WEIGHT ** 2) * ((o_sd * share) ** 2)
    sd_used = max(6.0 if not long_floor else LONG_SIGMA_FLOOR, math.sqrt(var))

    # TD props via Poisson tail
    if key in ("pass_tds", "rush_tds", "rec_tds"):
        player_rate = max(0.05, p_mu)
        opp_rate = max(0.05, o_mu)
        lam = 0.65 * player_rate + 0.35 * opp_rate
        p_over = _poisson_sf(line - 1.0, lam)  # P(X >= line)
        p_raw = p_over if side == "over" else 1.0 - p_over
    else:
        p_over = 1.0 - _norm_cdf(line, mu_blend, sd_used)
        p_raw = p_over if side == "over" else 1.0 - p_over

    p = _logit_blend(p_raw, prior, 0.6)
    return {
        "p_hit": max(0.0, min(1.0, float(p))),
        "snapshot": get_snapshot(),
        "debug": {
            "metric": key,
            "mu_player": p_mu, "sd_player": p_sd, "n_player_games": p_games,
            "mu_allowed": o_mu, "sd_allowed": o_sd, "n_allowed_games": o_games,
            "mu_blend": mu_blend, "sd_used": sd_used,
            "team": p_team, "pos": p_pos
        }
    }

def compute_moneyline(team: str, opponent: str) -> Dict[str, Any]:
    pf_mu, _, _ = _team_allowed_stat(team, "points_for")
    pa_mu, _, _ = _team_allowed_stat(opponent, "points")
    pf_mu_opp, _, _ = _team_allowed_stat(opponent, "points_for")
    pa_mu_team, _, _ = _team_allowed_stat(team, "points")

    exp_for = 0.7 * pf_mu + 0.3 * pa_mu
    exp_against = 0.7 * pf_mu_opp + 0.3 * pa_mu_team

    p_win = 1.0 - _norm_cdf(0.0, exp_against - exp_for, SCORE_DIFF_SD)
    return {
        "p_win": max(0.0, min(1.0, float(p_win))),
        "expected_points_for": float(exp_for),
        "expected_points_against": float(exp_against),
        "snapshot": get_snapshot()
    }







