# src/engine/nfl_bet_engine.py
from __future__ import annotations
import math, os, io, pathlib, re
from typing import Dict, Any, Tuple, Optional, List
import pandas as pd
import requests

# -----------------------------
# Settings
# -----------------------------
HISTORY_GAMES = 30
ROOKIE_MIN_GAMES = 4

LONG_SIGMA_FLOOR = 10.0
SCORE_DIFF_SD = 13.0

CURR_SEASON = int(os.getenv("SEASON", "2025"))
SEASONS_BACK = int(os.getenv("SEASONS_BACK", "3"))
SEASONS = list(range(max(2009, CURR_SEASON - SEASONS_BACK + 1), CURR_SEASON + 1))

CSV_URL = "https://github.com/nflverse/nflverse-data/releases/download/player_stats/stats_player_week_{year}.csv"

# -----------------------------
# In-memory snapshot (light)
# -----------------------------
_WEEKLY: Optional[pd.DataFrame] = None
_SNAPSHOT: Dict[str, Any] = {}

# Map front-end "kind" -> (weekly_column, internal_key, position_bucket)
# NOTE: We allow cross-position rushing and attempts + receiving targets.
_METRIC_MAP = {
    # Passing (QB)
    "qb_pass_yards": ("passing_yards", "pass_yds", "QB"),
    "qb_pass_tds": ("passing_tds", "pass_tds", "QB"),
    "qb_completions": ("completions", "comp", "QB"),
    "qb_pass_attempts": ("attempts", "pass_att", "QB"),

    # Rushing (QB/RB/WR/TE)
    "qb_rush_yards": ("rushing_yards", "rush_yds", "QB"),
    "rb_rush_yards": ("rushing_yards", "rush_yds", "RB"),
    "wr_rush_yards": ("rushing_yards", "rush_yds", "WRTE"),
    "te_rush_yards": ("rushing_yards", "rush_yds", "WRTE"),

    "qb_rush_tds": ("rushing_tds", "rush_tds", "QB"),
    "rb_rush_tds": ("rushing_tds", "rush_tds", "RB"),
    "wr_rush_tds": ("rushing_tds", "rush_tds", "WRTE"),
    "te_rush_tds": ("rushing_tds", "rush_tds", "WRTE"),

    "qb_rush_attempts": ("rushing_attempts", "rush_att", "QB"),
    "rb_rush_attempts": ("rushing_attempts", "rush_att", "RB"),
    "wr_rush_attempts": ("rushing_attempts", "rush_att", "WRTE"),
    "te_rush_attempts": ("rushing_attempts", "rush_att", "WRTE"),

    # Receiving (RB/WR/TE)
    "rb_rec_yards": ("receiving_yards", "rec_yds", "RB"),
    "wr_rec_yards": ("receiving_yards", "rec_yds", "WRTE"),
    "te_rec_yards": ("receiving_yards", "rec_yds", "WRTE"),

    "rb_rec_tds": ("receiving_tds", "rec_tds", "RB"),
    "wr_rec_tds": ("receiving_tds", "rec_tds", "WRTE"),
    "te_rec_tds": ("receiving_tds", "rec_tds", "WRTE"),

    "rb_receptions": ("receptions", "rec", "RB"),
    "wr_receptions": ("receptions", "rec", "WRTE"),
    "te_receptions": ("receptions", "rec", "WRTE"),

    "rb_targets": ("targets", "targets", "RB"),
    "wr_targets": ("targets", "targets", "WRTE"),
    "te_targets": ("targets", "targets", "WRTE"),

    # Kicker
    "k_fg_made": ("field_goals_made", "fgm", "K"),
    "k_fg_attempts": ("field_goals_attempted", "fga", "K"),
    "k_xp_made": ("extra_points_made", "xpm", "K"),
    "k_xp_attempts": ("extra_points_attempted", "xpa", "K"),
    # Flexible threshold market: did the kicker make >= line yards in a FG this game?
    # Line is the yardage threshold L (e.g., 40, 50, 60)
    "k_fg_long_made": ("field_goals_long", "fg_long_any", "K"),
}

# Team allowed mapping (how much opponents did vs this team)
_TEAM_ALLOWED_KEYS = {
    "pass_yds": "passing_yards",
    "pass_tds": "passing_tds",
    "comp": "completions",
    "pass_att": "attempts",

    "rush_yds": "rushing_yards",
    "rush_tds": "rushing_tds",
    "rush_att": "rushing_attempts",

    "rec_yds": "receiving_yards",
    "rec_tds": "receiving_tds",
    "rec": "receptions",
    "targets": "targets",

    "fgm": "field_goals_made",
    "fga": "field_goals_attempted",
    "xpm": "extra_points_made",
    "xpa": "extra_points_attempted",
    "fg_long": "field_goals_long",

    # Points (proxy via TDs)
    "points_for": None,
    "points": None,
}

# -----------------------------
# Helpers
# -----------------------------
def _poisson_sf(k: float, lam: float) -> float:
    """P(X > k) for Poisson; normal approx at high λ."""
    k = float(k); lam = max(1e-9, float(lam))
    if lam > 20.0:
        return 1.0 - _norm_cdf(k + 0.5, lam, math.sqrt(lam))
    n = int(math.floor(k))
    acc = 0.0
    term = math.exp(-lam)
    acc += term
    for i in range(1, n + 1):
        term *= lam / i
        acc += term
    return max(0.0, 1.0 - acc)

def _norm_cdf(x: float, mu: float, sd: float) -> float:
    sd = max(1e-9, float(sd))
    z = (float(x) - float(mu)) / sd
    t = 1.0 / (1.0 + 0.2316419 * abs(z))
    d = 0.3989423 * math.exp(-z * z / 2.0)
    prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
    if z > 0:
        return 1.0 - prob
    return prob

def _logit_blend(p: float, prior: float, strength: float = 0.5) -> float:
    """Blend probability p with prior on logit scale (strength in [0,1])."""
    p = max(1e-9, min(1 - 1e-9, float(p)))
    prior = max(1e-9, min(1 - 1e-9, float(prior)))
    def logit(x): return math.log(x / (1.0 - x))
    def inv(z): return 1.0 / (1.0 + math.exp(-z))
    return inv((1 - strength) * logit(p) + strength * logit(prior))

def _last_n_non_null(series: pd.Series, n: int) -> pd.Series:
    s = pd.to_numeric(series, errors="coerce").dropna()
    if s.empty:
        return s
    return s.iloc[-min(n, len(s)):]

def _league_pos_stats(metric_key: str) -> Tuple[float, float, str]:
    # Very light baseline by position bucket
    pos = _pos_for_key(metric_key)
    # heuristic baselines
    if metric_key in ("comp", "pass_att", "pass_yds", "pass_tds"):
        return (220.0 if metric_key == "pass_yds" else (1.6 if metric_key == "pass_tds" else 30.0)), 50.0, pos
    if metric_key in ("rush_yds", "rush_tds", "rush_att"):
        return (54.0 if metric_key == "rush_yds" else (0.4 if metric_key == "rush_tds" else 9.0)), 30.0, pos
    if metric_key in ("rec", "rec_yds", "rec_tds", "targets"):
        return (3.1 if metric_key == "rec" else (41.0 if metric_key == "rec_yds" else (0.4 if metric_key == "rec_tds" else 5.8))), 25.0, pos
    if metric_key in ("fgm","fga","xpm","xpa","fg_long"):
        return (1.7 if metric_key == "fgm" else (2.1 if metric_key == "fga" else (2.6 if metric_key == "xpm" else (2.7 if metric_key == "xpa" else 44.0)))), 12.0, "K"
    if metric_key in ("points_for", "points"):
        return (22.0 if metric_key == "points_for" else 22.0), 7.0, "TEAM"
    return 10.0, 10.0, pos

def _pos_for_key(metric_key: str) -> str:
    for k, (_, key, pos) in _METRIC_MAP.items():
        if key == metric_key:
            return pos
    return "UNK"

# -----------------------------
# Data loading (lazy)
# -----------------------------
def _load_weekly(year: int) -> pd.DataFrame:
    cache_dir = pathlib.Path(".cache_nflverse")
    cache_dir.mkdir(exist_ok=True)
    cache = cache_dir / f"stats_player_week_{year}.csv"
    if cache.exists():
        return pd.read_csv(cache, low_memory=False)
    url = CSV_URL.format(year=year)
    resp = requests.get(url, timeout=10)
    resp.raise_for_status()
    cache.write_bytes(resp.content)
    return pd.read_csv(io.BytesIO(resp.content), low_memory=False)

# ---- Column normalizer ------------------------------------
def _first_col(df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
    for c in candidates:
        if c in df.columns:
            return c
    return None

def _normalize_name(s: str) -> str:
    s = s.lower()
    s = re.sub(r"[^a-z0-9\s]", " ", s)  # strip punctuation
    s = re.sub(r"\s+", " ", s).strip()
    # drop suffix tokens
    toks = s.split()
    suffixes = {"jr", "sr", "ii", "iii", "iv", "v"}
    toks = [t for t in toks if t not in suffixes]
    return " ".join(toks)

def _normalize_week_df(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    # Try to build a best full name
    fn_col = _first_col(df, ["player_first_name","first_name","firstname"])
    ln_col = _first_col(df, ["player_last_name","last_name","lastname","player_surname"])
    built_full = None
    if fn_col and ln_col:
        built_full = (df[fn_col].astype(str).str.strip() + " " + df[ln_col].astype(str).str.strip()).str.strip()

    name_col = _first_col(df, ["player_name","full_name","name","player_display_name","player","Player"])
    if built_full is not None:
        player_name = built_full
    elif name_col:
        # Expand initials like "P.Mahomes" -> "P Mahomes"
        player_name = df[name_col].astype(str).str.replace(".", " ", regex=False)
    else:
        player_name = pd.Series([""], index=df.index)

    df["player_name"] = player_name.fillna("").astype(str)
    df["player_name_norm"] = df["player_name"].map(_normalize_name)

    pos_col = _first_col(df, ["position","pos"])
    df["position"] = (df[pos_col].astype(str) if pos_col else "").str.upper()

    team_col = _first_col(df, ["recent_team","recent_team_abbr","team","team_abbr","posteam"])
    opp_col  = _first_col(df, ["opponent_team","opp_team","opp","defteam"])
    df["recent_team"] = (df[team_col].astype(str).str.upper() if team_col else "")
    df["opponent_team"] = (df[opp_col].astype(str).str.upper() if opp_col else "")

    if "season" not in df.columns: df["season"] = pd.NA
    if "week" not in df.columns:   df["week"] = pd.NA

    def numcol(out: str, cands: List[str]):
        col = _first_col(df, cands)
        if col and col in df.columns:
            df[out] = pd.to_numeric(df[col], errors="coerce")
        else:
            df[out] = pd.NA

    # normalize numeric columns we care about
    numcol("completions", ["completions","cmp","pass_completions"])
    numcol("attempts", ["attempts","att","pass_att","pass_attempts"])
    numcol("passing_yards", ["passing_yards","pass_yds","pass_yards","py","yards_pass"])
    numcol("passing_tds", ["passing_tds","pass_tds","pass_td"])
    numcol("rushing_yards", ["rushing_yards","rush_yards","ry","yards_rush"])
    numcol("rushing_tds", ["rushing_tds","rush_tds"])
    numcol("rushing_attempts", ["rushing_attempts","rush_att"])
    numcol("receiving_yards", ["receiving_yards","rec_yds","rec_yards","yards_rec"])
    numcol("receptions", ["receptions","rec"])
    numcol("receiving_tds", ["receiving_tds","rec_tds"])
    numcol("targets", ["targets"])
    numcol("field_goals_made", ["field_goals_made","fgm","kicking_fg_made"])
    numcol("field_goals_attempted", ["field_goals_attempted","fga"])
    numcol("extra_points_made", ["extra_points_made","xpm"])
    numcol("extra_points_attempted", ["extra_points_attempted","xpa"])
    numcol("field_goals_long", ["field_goals_long","fg_long"])

    # points via TD proxy (4 pts pass, 6 rush/rec — rough team scoring proxy)
    df["points_for_proxy"] = (
        df["passing_tds"].fillna(0) * 4.0
        + (df["rushing_tds"].fillna(0) + df["receiving_tds"].fillna(0)) * 6.0
    )

    return df[[
        "season","week","player_name","player_name_norm","recent_team","opponent_team","position",
        "completions","attempts","passing_yards","passing_tds",
        "rushing_yards","rushing_tds","rushing_attempts",
        "receiving_yards","receptions","receiving_tds","targets",
        "field_goals_made","field_goals_attempted","extra_points_made","extra_points_attempted","field_goals_long",
        "points_for_proxy"
    ]]

def _load_and_combine(seasons: List[int]) -> pd.DataFrame:
    frames = []
    for y in seasons:
        try:
            raw = _load_weekly(y)
            frames.append(_normalize_week_df(raw))
        except Exception:
            continue
    if not frames:
        return pd.DataFrame(columns=[
            "season","week","player_name","player_name_norm","recent_team","opponent_team","position",
            "completions","attempts","passing_yards","passing_tds",
            "rushing_yards","rushing_tds","rushing_attempts",
            "receiving_yards","receptions","receiving_tds","targets",
            "field_goals_made","field_goals_attempted","extra_points_made","extra_points_attempted","field_goals_long",
            "points_for_proxy"
        ])
    return pd.concat(frames, ignore_index=True)

def _ensure_minimal():
    global _WEEKLY, _SNAPSHOT
    if _WEEKLY is None:
        _WEEKLY = pd.DataFrame(columns=[
            "season","week","player_name","player_name_norm","recent_team","opponent_team","position",
            "completions","attempts","passing_yards","passing_tds",
            "rushing_yards","rushing_tds","rushing_attempts",
            "receiving_yards","receptions","receiving_tds","targets",
            "field_goals_made","field_goals_attempted","extra_points_made","extra_points_attempted","field_goals_long",
            "points_for_proxy"
        ])
        _SNAPSHOT = {
            "snapshot_ts": pd.Timestamp.utcnow().isoformat(timespec="seconds"),
            "seasons": SEASONS,
            "rows": 0
        }

# -----------------------------
# Public refresh/load
# -----------------------------
def refresh_data(seasons: Optional[List[int]] = None) -> Dict[str, Any]:
    global _WEEKLY, _SNAPSHOT
    _WEEKLY = _load_and_combine(seasons or SEASONS)
    _SNAPSHOT = {
        "snapshot_ts": pd.Timestamp.utcnow().isoformat(timespec="seconds"),
        "seasons": seasons or SEASONS,
        "rows": int(len(_WEEKLY))
    }
    return _SNAPSHOT

def get_snapshot() -> Dict[str, Any]:
    _ensure_minimal()
    return dict(_SNAPSHOT)

# -----------------------------
# Name matching utilities
# -----------------------------
def _match_player(df: pd.DataFrame, target_name: str) -> pd.DataFrame:
    """
    Attempt robust player matching:
    1) exact normalized, 2) startswith first+last, 3) contains both tokens,
    4) last name + first initial, 5) substring fallback
    """
    if df.empty:
        return df
    names_norm = df["player_name_norm"].fillna("").astype(str)
    t_norm = _normalize_name(target_name or "")
    if not t_norm:
        return df.iloc[0:0]

    # 1) exact
    sub = df[names_norm == t_norm]
    if not sub.empty:
        return sub

    toks = t_norm.split()
    if len(toks) >= 2:
        # 2) startswith both tokens
        mask = names_norm.str.startswith(toks[0] + " ") & names_norm.str.contains(fr"\b{re.escape(toks[-1])}\b", regex=True)
        sub = df[mask]
        if not sub.empty:
            return sub
        # 3) contains both tokens anywhere
        mask = names_norm.str.contains(fr"\b{re.escape(toks[0])}\b", regex=True)
        for tok in toks[1:]:
            mask = mask & names_norm.str.contains(fr"\b{re.escape(tok)}\b", regex=True)
        sub = df[mask]
        if not sub.empty:
            return sub
        # 4) last-name + first-initial
        last = toks[-1]
        first = toks[0]
        first_initial = first[0]
        # names with last name present
        mask_last = names_norm.str.contains(fr"\b{re.escape(last)}\b", regex=True)
        if mask_last.any():
            first_tokens = names_norm.str.split().str[0].str[:1]  # first initial from normalized name
            sub2 = df[mask_last & (first_tokens == first_initial)]
            if not sub2.empty:
                return sub2
    # 5) substring fallback
    sub = df[names_norm.str.contains(re.escape(t_norm), regex=True)]
    return sub

# -----------------------------
# Lookups (on-demand)
# -----------------------------
def _player_stat(player: str, metric_key: str) -> Tuple[float, float, Optional[str], Optional[str], int]:
    """
    Return (mu, sd, last_team, pos, n_games) for the given player & metric key.
    If we can't confidently match the player, we return **position-specific league baselines**.
    """
    _ensure_minimal()
    assert _WEEKLY is not None
    # map key -> weekly column
    weekly_col = _TEAM_ALLOWED_KEYS.get(metric_key, None)
    if weekly_col is None and metric_key not in ("points_for", "points"):
        # find by reverse lookup from metric map
        for _, (wk, key, _) in _METRIC_MAP.items():
            if key == metric_key:
                weekly_col = wk
                break

    df = _WEEKLY
    sub = _match_player(df, player)
    if sub.empty:
        mu_b, sd_b, pos_guess = _league_pos_stats(metric_key)
        return mu_b, sd_b, None, pos_guess, 0

    # sort by season/week if present
    if "season" in sub.columns and "week" in sub.columns:
        sub = sub.sort_values(["season","week"])

    # compute tail stats
    col = weekly_col if weekly_col in sub.columns else None
    if col is None:
        mu_b, sd_b, pos_guess = _league_pos_stats(metric_key)
        return mu_b, sd_b, None, pos_guess, 0

    team = sub["recent_team"].dropna().astype(str).str.upper()
    team = team.iloc[-1] if not team.empty else None
    pos  = sub["position"].dropna().astype(str).str.upper()
    pos  = pos.iloc[-1] if not pos.empty else _pos_for_key(metric_key)

    tail = _last_n_non_null(sub[col], HISTORY_GAMES) if col in sub.columns else pd.Series([], dtype=float)
    n = len(tail)
    if n < ROOKIE_MIN_GAMES:
        mu_b, sd_b, _ = _league_pos_stats(metric_key)
        return mu_b, sd_b, team, pos, 0

    mu = float(tail.mean())
    sd = float(tail.std(ddof=0)) if n > 1 else 0.0
    return mu, sd, team, pos, n

def _team_allowed_stat(team: str, metric_key: str) -> Tuple[float, float, int]:
    """
    Return (mu, sd, n_games) of what the team allows for a given metric.
    Compute **per-game totals** vs the team, then mean/sd across games.
    """
    _ensure_minimal()
    assert _WEEKLY is not None
    df = _WEEKLY
    tkey = (team or "").upper()
    if not tkey:
        return 0.0, 0.0, 0

    # Points via TD proxy (aggregate per game)
    if metric_key in ("points_for","points"):
        tmp = df.copy()
        if metric_key == "points_for":
            # offense: sum points_for_proxy for players on team each game
            side = tmp[tmp["recent_team"].astype(str).str.upper() == tkey]
            per_game = side.groupby(["season","week","opponent_team"])["points_for_proxy"].sum()
        else:
            side = tmp[tmp["opponent_team"].astype(str).str.upper() == tkey]
            per_game = side.groupby(["season","week","recent_team"])["points_for_proxy"].sum()

        tail = _last_n_non_null(per_game, HISTORY_GAMES)
        n = len(tail)
        mu = float(tail.mean()) if n > 0 else 21.0
        sd = float(tail.std(ddof=0)) if n > 1 else 7.0
        return mu, sd, n

    weekly_col = _TEAM_ALLOWED_KEYS.get(metric_key)
    if weekly_col is None or df.empty or weekly_col not in df.columns:
        return 0.0, 0.0, 0

    side = df[df["opponent_team"].astype(str).str.upper() == tkey]
    if side.empty:
        return 0.0, 0.0, 0

    vals = pd.to_numeric(side[weekly_col], errors="coerce").fillna(0.0)
    per_game = vals.groupby([side["season"], side["week"], side["recent_team"]]).sum()

    tail = _last_n_non_null(per_game, HISTORY_GAMES)
    n = len(tail)
    mu = float(tail.mean()) if n > 0 else 0.0
    sd = float(tail.std(ddof=0)) if n > 1 else 0.0
    return mu, sd, n

# -----------------------------
# Kicker distance helpers
# -----------------------------
def _league_fg_make_prob(distance_yards: float) -> float:
    """Smooth league make probability as a function of distance (approx curve).
    Values are conservative; used as a prior for long-distance attempts.
    """
    d = float(distance_yards)
    # Piecewise-linear approximation of modern NFL rates
    if d < 30: return 0.97
    if d < 35: return 0.95
    if d < 40: return 0.92
    if d < 45: return 0.86
    if d < 50: return 0.78
    if d < 55: return 0.66
    if d < 60: return 0.52
    if d < 63: return 0.38
    return 0.30

def _blend_rate(emp: float, emp_w: float, prior: float) -> float:
    """EB-style blend of empirical rate and prior; emp_w in [0,1]."""
    emp = max(0.0, min(1.0, emp))
    prior = max(0.0, min(1.0, prior))
    w = max(0.0, min(1.0, emp_w))
    return w*emp + (1.0-w)*prior

# -----------------------------
# Public computations
# -----------------------------
def _compute_kicker_long_made(player: str, opponent_team: str, side: str, threshold_yards: float) -> Dict[str, Any]:
    """
    Flexible market: Will the kicker make at least one FG of length >= threshold_yards?
    We estimate:
      - lambda_long_attempts: expected attempts from >= L yards (Poisson rate)
      - p_make_given_attempt: per-attempt make probability at >= L (EB blend of league curve + kicker signal)
      - Final: P(at least one made) = 1 - exp(-lambda_long_attempts * p_make_given_attempt)
    """
    L = float(threshold_yards)
    # Player empirical: per-game indicator that fg_long >= L
    _ensure_minimal()
    df = _WEEKLY if _WEEKLY is not None else pd.DataFrame()
    player_rows = _match_player(df, player)
    made_indicator = pd.Series([], dtype=float)
    fga_series = pd.Series([], dtype=float)
    fg_long_series = pd.Series([], dtype=float)
    if not player_rows.empty:
        pr = player_rows.sort_values(["season","week"])
        if "field_goals_long" in pr.columns:
            fg_long_series = pd.to_numeric(pr["field_goals_long"], errors="coerce").fillna(0.0)
            made_indicator = (fg_long_series >= L).astype(float)
        if "field_goals_attempted" in pr.columns:
            fga_series = pd.to_numeric(pr["field_goals_attempted"], errors="coerce").fillna(0.0)

    tail_made = _last_n_non_null(made_indicator, HISTORY_GAMES)
    tail_fga = _last_n_non_null(fga_series, HISTORY_GAMES)
    tail_long = _last_n_non_null(fg_long_series, HISTORY_GAMES)

    n_games = int(len(tail_made)) if len(tail_made)>0 else 0
    rate_made_ge_L_emp = float(tail_made.mean()) if n_games>0 else 0.0
    fga_pg = float(tail_fga.mean()) if len(tail_fga)>0 else 0.0
    p95_long = float(tail_long.quantile(0.95)) if len(tail_long)>0 else 0.0

    # Defense empirical: games where opponents had fg_long >= L against them
    o_mu_allowed, o_sd_allowed, o_games = _team_allowed_stat(opponent_team, "fg_long")
    # Convert allowed mean of longest made into a crude rate proxy:
    # assume longest made >= L occurs with rate roughly increasing as mean_long increases past L.
    # We proxy allowed rate via sigmoid on (mean_long - L).
    def sig(x): return 1.0/(1.0+math.exp(-x))
    allowed_rate_proxy = sig((o_mu_allowed - L)/6.0) if o_games>0 else 0.2

    # League prior at L
    league_make_at_L = _league_fg_make_prob(L)

    # EB weights by sample sizes
    p_w = max(0.0, min(1.0, n_games / float(max(1, HISTORY_GAMES))))
    o_w = max(0.0, min(1.0, o_games / float(max(1, HISTORY_GAMES))))

    # Estimate attempt share >= L: if you make at rate r and league p_make is p,
    # attempt share ~ r / p (capped 0..1). Blend player and opponent.
    attempt_share_player = min(1.0, rate_made_ge_L_emp / max(league_make_at_L, 0.05)) if league_make_at_L>0 else 0.2
    attempt_share_def = min(1.0, allowed_rate_proxy / max(league_make_at_L, 0.05)) if league_make_at_L>0 else 0.2
    attempt_share = _blend_rate(attempt_share_player, p_w, attempt_share_def)

    # Expected attempts from >=L: blend player's FGA with opponent allowed FGA to kickers
    o_fga_mu, _, _ = _team_allowed_stat(opponent_team, "fga")
    fga_pg_blend = _blend_rate(fga_pg, 0.6*p_w + 0.2, o_fga_mu)  # bias toward player when we have player data
    lambda_long_attempts = max(0.0, fga_pg_blend * attempt_share)

    # Per-attempt make probability at distance L:
    # start from league curve, then apply kicker ability uplift based on long-distance track record (p95_long vs L)
    ability_uplift = 0.10 * (1.0/(1.0+math.exp(-(p95_long - L)/7.0)) - 0.5)  # in ~[-0.05, +0.05]
    p_make_L_player_prior = max(0.05, min(0.99, league_make_at_L * (1.0 + ability_uplift)))

    # Blend with opponent defense difficulty at long range via a mild adjustment
    def_make_adj = (allowed_rate_proxy / max(0.20, 0.50))  # normalize around typical rate
    p_make_L_blend = max(0.03, min(0.99, _blend_rate(p_make_L_player_prior, 0.5, league_make_at_L*def_make_adj)))

    # Final probability of >=1 make
    lam_makes = lambda_long_attempts * p_make_L_blend
    p_any = 1.0 - math.exp(-lam_makes)
    p_raw = p_any if side == "over" else (1.0 - p_any)
    p = _logit_blend(p_raw, 0.5, 0.35)

    return {
        "p_hit": max(0.0, min(1.0, float(p))),
        "decomp": {
            "lambda_long_attempts": float(lambda_long_attempts),
            "p_make_given_attempt": float(p_make_L_blend),
            "league_make_at_threshold": float(league_make_at_L),
            "p95_long": float(p95_long),
            "attempt_share": float(attempt_share),
            "fga_per_game": float(fga_pg),
        },
        "snapshot": get_snapshot()
    }

def compute_prop_probability(player: str, opponent_team: str, kind: str,
                             side: str, line: float) -> Dict[str, Any]:
    """
    Probability a prop hits given a player, opponent, market kind, side, and line.
    Supports:
      - Passing (QB): yards/TDs/completions/attempts
      - Rushing (QB/RB/WR/TE): yards/TDs/attempts
      - Receiving (RB/WR/TE): yards/TDs/receptions/targets
      - Kicker: FGM, FGA, XPM, XPA, and 'k_fg_long_made' (>= line yards made)
    """
    kind = kind.lower()
    if kind not in _METRIC_MAP:
        raise ValueError(f"Unsupported prop kind: {kind}")

    weekly_col, key, _ = _METRIC_MAP[kind]

    # Special handling: kicker long made with arbitrary threshold (line in yards)
    if key == "fg_long_any":
        return _compute_kicker_long_made(player, opponent_team, side, line)

    # For other props, proceed with generic modeling
    p_mu, p_sd, p_team, p_pos, p_games = _player_stat(player, key)
    o_mu, o_sd, o_games = _team_allowed_stat(opponent_team, key)
    base_mu, base_sd, _ = _league_pos_stats(key)

    # EB shrink
    p_w = max(0.0, min(1.0, p_games / float(max(1, HISTORY_GAMES))))
    o_w = max(0.0, min(1.0, o_games / float(max(1, HISTORY_GAMES))))
    p_mu_shrunk = p_w * p_mu + (1.0 - p_w) * base_mu
    o_mu_shrunk = o_w * o_mu + (1.0 - o_w) * base_mu
    p_sd_used = p_sd if p_sd > 0 else base_sd
    o_sd_used = o_sd if o_sd > 0 else base_sd

    # Dynamic weights
    dyn_def_w = max(0.1, min(0.9, 0.5 * (o_w + 0.25)))
    dyn_player_w = 1.0 - dyn_def_w

    # Receiving usage share for WR/TE/RB yards/receptions/TDs/targets
    share = 1.0
    if key in ("rec", "rec_yds", "rec_tds", "targets"):
        share = 0.18 + 0.12 * p_w  # 18%..30%

    mu_blend = dyn_player_w * p_mu_shrunk + dyn_def_w * (o_mu_shrunk * share)
    var = (dyn_player_w ** 2) * (p_sd_used ** 2) + (dyn_def_w ** 2) * ((o_sd_used * share) ** 2)

    is_long = key in ("long_rec_proxy", "long_rush_proxy")
    sd_floor = LONG_SIGMA_FLOOR if is_long else 6.0
    sd_used = max(sd_floor, math.sqrt(max(var, 1e-6)))

    # Decide distribution family
    count_like = key in ("pass_att","rush_att","rec","targets","fga","xpa","xpm","fgm")
    td_like = key in ("pass_tds","rush_tds","rec_tds")

    if td_like:
        lam = max(0.01, 0.65 * p_mu_shrunk + 0.35 * o_mu_shrunk)
        p_over = _poisson_sf(line - 1.0, lam)
        p_raw = p_over if side == "over" else (1.0 - p_over)
    elif count_like:
        lam = max(0.01, mu_blend)
        p_over = _poisson_sf(line - 1.0, lam)
        p_raw = p_over if side == "over" else (1.0 - p_over)
    else:
        p_over = 1.0 - _norm_cdf(line, mu_blend, sd_used)
        p_raw = p_over if side == "over" else (1.0 - p_over)

    p = _logit_blend(p_raw, 0.5, 0.55)

    return {
        "p_hit": max(0.0, min(1.0, float(p))),
        "mu_player": float(p_mu),
        "sd_player": float(p_sd_used),
        "mu_def_allowed": float(o_mu),
        "sd_def_allowed": float(o_sd_used),
        "mu_blend": float(mu_blend),
        "sd_used": float(sd_used),
        "games_player": int(p_games),
        "games_def": int(o_games),
        "share_used": float(share),
        "snapshot": get_snapshot()
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

# -----------------------------
# PUBLIC DEBUG HELPERS (for /debug endpoints)
# -----------------------------
def list_players(prefix: str = "", limit: int = 25) -> List[str]:
    _ensure_minimal()
    assert _WEEKLY is not None
    names = _WEEKLY.get("player_name", pd.Series([], dtype=object)).dropna().astype(str).unique().tolist()
    if prefix:
        pfx = prefix.lower()
        names = [n for n in names if n.lower().startswith(pfx)]
    return sorted(names)[:limit]

def list_teams(limit: int = 100) -> List[str]:
    _ensure_minimal()
    assert _WEEKLY is not None
    teams = _WEEKLY.get("recent_team", pd.Series([], dtype=object)).dropna().astype(str).str.upper().unique().tolist()
    teams = [t for t in teams if t and t.isalpha() and len(t) <= 4]
    return teams

def list_metric_keys() -> List[str]:
    keys = {v[1] for v in _METRIC_MAP.values()}
    keys.update(["points_for", "points"])
    return sorted(keys)

def get_player_metric(player: str, metric_or_kind: str) -> Dict[str, Any]:
    kk = metric_or_kind.strip().lower()
    if kk in _METRIC_MAP:
        key = _METRIC_MAP[kk][1]
    else:
        key = kk
    mu, sd, team, pos, n = _player_stat(player, key)
    return {"player": player, "metric_key": key, "mu": mu, "sd": sd, "team": team, "pos": pos, "n_games": n}

def get_team_allowed(team: str, metric_or_kind: str) -> Dict[str, Any]:
    kk = metric_or_kind.strip().lower()
    if kk in _METRIC_MAP:
        key = _METRIC_MAP[kk][1]
    else:
        key = kk
    mu, sd, n = _team_allowed_stat(team, key)
    return {"team": team.upper(), "metric_key": key, "mu": mu, "sd": sd, "n_games": n}















