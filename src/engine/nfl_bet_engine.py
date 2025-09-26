# src/engine/nfl_bet_engine.py
from __future__ import annotations
import math, os, io, pathlib
from typing import Dict, Any, Tuple, Optional, List
import pandas as pd
import requests

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
SEASONS_BACK = int(os.getenv("SEASONS_BACK", "1"))  # keep small for serverless speed
SEASONS = list(range(max(2009, CURR_SEASON - SEASONS_BACK + 1), CURR_SEASON + 1))

# nflverse CSV weekly player stats (one file per season)
CSV_URL = "https://github.com/nflverse/nflverse-data/releases/download/player_stats/stats_player_week_{year}.csv"

# -----------------------------
# In-memory snapshot (light!)
# -----------------------------
_WEEKLY: Optional[pd.DataFrame] = None
_LEAGUE_MEAN: Dict[str, float] = {}
_LEAGUE_SD: Dict[str, float] = {}
_SNAPSHOT: Dict[str, Any] = {}

# For mapping prop kinds to weekly columns and our internal keys
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
    # WR/TE
    "wr_rec_yards": ("receiving_yards", "rec_yds"),
    "wr_receptions": ("receptions", "rec"),
    "wr_longest_catch": ("receiving_yards", "long_rec_proxy"),
    "wr_rec_tds": ("receiving_tds", "rec_tds"),
    "te_rec_yards": ("receiving_yards", "rec_yds"),
    "te_receptions": ("receptions", "rec"),
    "te_longest_catch": ("receiving_yards", "long_rec_proxy"),
    "te_rec_tds": ("receiving_tds", "rec_tds"),
    # K
    "k_fg_made": ("field_goals_made", "fgm"),
}

# Team allowed mapping (opponent perspective)
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
    # points via TD proxy
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
# Lightweight CSV loader (+ /tmp cache)
# -----------------------------
_TMP = pathlib.Path("/tmp")

def _fetch_weekly_csv(year: int) -> pd.DataFrame:
    cache = _TMP / f"stats_player_week_{year}.csv"
    if cache.exists():
        return pd.read_csv(cache, low_memory=False)
    url = CSV_URL.format(year=year)
    resp = requests.get(url, timeout=7)
    resp.raise_for_status()
    cache.write_bytes(resp.content)
    return pd.read_csv(io.BytesIO(resp.content), low_memory=False)

def _load_weekly(seasons: List[int]) -> pd.DataFrame:
    frames = []
    for y in seasons:
        try:
            frames.append(_fetch_weekly_csv(y))
        except Exception as e:
            print(f"[nfl_bet_engine] warn: failed loading {y}: {e}")
    if not frames:
        cols = [
            "season","week","player_name","recent_team","opponent_team","position",
            "completions","attempts","passing_yards","passing_tds",
            "rushing_yards","rushing_tds",
            "receiving_yards","receptions","receiving_tds",
            "field_goals_made"
        ]
        return pd.DataFrame(columns=cols)
    df = pd.concat(frames, ignore_index=True)
    must = ["season","week","player_name","recent_team","opponent_team","position"]
    for c in must:
        if c not in df.columns:
            df[c] = pd.NA
    if "field_goals_made" not in df.columns:
        df["field_goals_made"] = 0
    return df

def _init_empty_baselines():
    global _LEAGUE_MEAN, _LEAGUE_SD
    _LEAGUE_MEAN = {k: 0.0 for _, k in _METRIC_MAP.values()}
    _LEAGUE_SD   = {k: 0.0 for _, k in _METRIC_MAP.values()}

def _ensure_minimal():
    global _WEEKLY, _SNAPSHOT
    if _WEEKLY is None:
        _WEEKLY = pd.DataFrame(columns=[
            "season","week","player_name","recent_team","opponent_team","position",
            "completions","attempts","passing_yards","passing_tds",
            "rushing_yards","rushing_tds",
            "receiving_yards","receptions","receiving_tds",
            "field_goals_made"
        ])
        _init_empty_baselines()
        _SNAPSHOT = {
            "snapshot_ts": pd.Timestamp.utcnow().isoformat(timespec="seconds"),
            "seasons": SEASONS,
            "rows": 0
        }

# -----------------------------
# Public refresh/load
# -----------------------------
def refresh_data(seasons: Optional[List[int]] = None) -> Dict[str, Any]:
    global _WEEKLY, _LEAGUE_MEAN, _LEAGUE_SD, _SNAPSHOT
    use_seasons = seasons or SEASONS
    weekly = _load_weekly(use_seasons)

    _LEAGUE_MEAN, _LEAGUE_SD = {}, {}
    for _, (col, key) in _METRIC_MAP.items():
        if col in weekly.columns:
            s = pd.to_numeric(weekly[col], errors="coerce").dropna()
            _LEAGUE_MEAN[key] = float(s.mean()) if not s.empty else 0.0
            _LEAGUE_SD[key]   = float(s.std(ddof=0)) if not s.empty else 0.0
        else:
            _LEAGUE_MEAN[key] = 0.0
            _LEAGUE_SD[key]   = 0.0

    _WEEKLY = weekly
    _SNAPSHOT = {
        "snapshot_ts": pd.Timestamp.utcnow().isoformat(timespec="seconds"),
        "seasons": use_seasons,
        "rows": int(len(weekly))
    }
    return {"status": "ok", **_SNAPSHOT}

def get_snapshot() -> Dict[str, Any]:
    _ensure_minimal()
    return dict(_SNAPSHOT)

# -----------------------------
# Lookups (on-demand)
# -----------------------------
def _last_n_non_null(values: pd.Series, n: int) -> pd.Series:
    vv = pd.to_numeric(values, errors="coerce").dropna().astype(float)
    if vv.empty: return vv
    return vv.iloc[-n:]

def _player_stat(player: str, metric_key: str) -> Tuple[float, float, Optional[str], Optional[str], int]:
    _ensure_minimal()
    assert _WEEKLY is not None
    col = None
    for c, k in _METRIC_MAP.values():
        if k == metric_key:
            col = c
            break
    if col is None:
        return 0.0, 0.0, None, None, 0

    df = _WEEKLY
    if df.empty:
        return _LEAGUE_MEAN.get(metric_key, 0.0), _LEAGUE_SD.get(metric_key, 0.0), None, None, 0

    sub = df[df["player_name"].str.lower() == (player or "").lower()]
    if sub.empty:
        sub = df[df["player_name"].str.lower().str.startswith((player or "").lower())]
        if sub.empty:
            return _LEAGUE_MEAN.get(metric_key, 0.0), _LEAGUE_SD.get(metric_key, 0.0), None, None, 0

    team = sub["recent_team"].dropna().iloc[-1] if not sub["recent_team"].dropna().empty else None
    pos  = sub["position"].dropna().iloc[-1] if not sub["position"].dropna().empty else None

    tail = _last_n_non_null(sub[col], HISTORY_GAMES) if col in sub.columns else pd.Series([], dtype=float)
    n = len(tail)
    if n < ROOKIE_MIN_GAMES:
        return _LEAGUE_MEAN.get(metric_key, 0.0), _LEAGUE_SD.get(metric_key, 0.0), team, pos, 0

    mu = float(tail.mean())
    sd = float(tail.std(ddof=0)) if n > 1 else 0.0
    return mu, sd, team, pos, n

def _team_allowed_stat(team: str, metric_key: str) -> Tuple[float, float, int]:
    _ensure_minimal()
    assert _WEEKLY is not None
    df = _WEEKLY

    if metric_key in ("points_for", "points"):
        pass_td = pd.to_numeric(df.get("passing_tds", 0), errors="coerce").fillna(0.0)
        rush_td = pd.to_numeric(df.get("rushing_tds", 0), errors="coerce").fillna(0.0)
        points_for_proxy = 6.0 * (pass_td + rush_td)
        tmp = df.copy()
        tmp["points_for_proxy"] = points_for_proxy

        if metric_key == "points_for":
            g = tmp[tmp["recent_team"].astype(str).str.upper() == (team or "").upper()]
        else:
            g = tmp[tmp["opponent_team"].astype(str).str.upper() == (team or "").upper()]

        tail = _last_n_non_null(g["points_for_proxy"], HISTORY_GAMES)
        n = len(tail)
        mu = float(tail.mean()) if n > 0 else 21.0
        sd = float(tail.std(ddof=0)) if n > 1 else 7.0
        return mu, sd, n

    weekly_col = _TEAM_ALLOWED_KEYS.get(metric_key)
    if weekly_col is None:
        return 0.0, 0.0, 0

    if df.empty or weekly_col not in df.columns:
        return 0.0, 0.0, 0

    g = df[df["opponent_team"].astype(str).str.upper() == (team or "").upper()]
    tail = _last_n_non_null(g[weekly_col], HISTORY_GAMES)
    n = len(tail)
    mu = float(tail.mean()) if n > 0 else 0.0
    sd = float(tail.std(ddof=0)) if n > 1 else 0.0
    return mu, sd, n

# -----------------------------
# Public computations
# -----------------------------
def compute_prop_probability(player: str, opponent_team: str, kind: str,
                             side: str, line: float) -> Dict[str, Any]:
    kind = kind.lower()
    if kind.startswith("te_"):
        kind = kind.replace("te_", "wr_")
    if kind == "qb_rush_tds":
        kind = "rb_rush_tds"

    if kind not in _METRIC_MAP:
        raise ValueError(f"Unsupported prop kind: {kind}")

    _, key = _METRIC_MAP[kind]
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

    # Receiving share adjustment
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
        p_over = _poisson_sf(line - 1.0, lam)
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









