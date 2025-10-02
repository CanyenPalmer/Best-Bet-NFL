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

DEF_WEIGHT = 0.30
LONG_SIGMA_FLOOR = 10.0
SCORE_DIFF_SD = 13.0

CURR_SEASON = int(os.getenv("SEASON", "2025"))
SEASONS_BACK = int(os.getenv("SEASONS_BACK", "3"))  # adjust via env in Vercel if desired
SEASONS = list(range(max(2009, CURR_SEASON - SEASONS_BACK + 1), CURR_SEASON + 1))

# nflverse CSV weekly player stats (one file per season)
CSV_URL = "https://github.com/nflverse/nflverse-data/releases/download/player_stats/stats_player_week_{year}.csv"

# -----------------------------
# In-memory snapshot (light!)
# -----------------------------
_WEEKLY: Optional[pd.DataFrame] = None
_SNAPSHOT: Dict[str, Any] = {}

# For mapping prop kinds to weekly columns, internal keys, and position buckets
_METRIC_MAP = {
    # QB
    "qb_pass_yards": ("passing_yards", "pass_yds", "QB"),
    "qb_pass_tds": ("passing_tds", "pass_tds", "QB"),
    "qb_completions": ("completions", "comp", "QB"),
    "qb_pass_attempts": ("attempts", "att", "QB"),
    # RB
    "rb_rush_yards": ("rushing_yards", "rush_yds", "RB"),
    "rb_rush_tds": ("rushing_tds", "rush_tds", "RB"),
    "rb_longest_run": ("rushing_yards", "long_rush_proxy", "RB"),
    # WR/TE
    "wr_rec_yards": ("receiving_yards", "rec_yds", "WRTE"),
    "wr_receptions": ("receptions", "rec", "WRTE"),
    "wr_longest_catch": ("receiving_yards", "long_rec_proxy", "WRTE"),
    "wr_rec_tds": ("receiving_tds", "rec_tds", "WRTE"),
    "te_rec_yards": ("receiving_yards", "rec_yds", "WRTE"),
    "te_receptions": ("receptions", "rec", "WRTE"),
    "te_longest_catch": ("receiving_yards", "long_rec_proxy", "WRTE"),
    "te_rec_tds": ("receiving_tds", "rec_tds", "WRTE"),
    # K
    "k_fg_made": ("field_goals_made", "fgm", "K"),
}

# Team allowed mapping (opponent perspective) — weekly column to sum per game
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
        df[out] = pd.to_numeric(df[col], errors="coerce").fillna(0.0) if col else 0.0

    numcol("completions",    ["completions","pass_completions"])
    numcol("attempts",       ["attempts","pass_attempts"])
    numcol("passing_yards",  ["passing_yards","pass_yards","yards_pass"])
    numcol("passing_tds",    ["passing_tds","pass_tds"])
    numcol("rushing_yards",  ["rushing_yards","rush_yards","yards_rush"])
    numcol("rushing_tds",    ["rushing_tds","rush_tds"])
    numcol("receiving_yards",["receiving_yards","rec_yards","yards_rec"])
    numcol("receptions",     ["receptions","rec"])
    numcol("receiving_tds",  ["receiving_tds","rec_tds"])
    numcol("field_goals_made", ["field_goals_made","fgm","kicking_fg_made"])

    keep = [
        "season","week","player_name","player_name_norm","recent_team","opponent_team","position",
        "completions","attempts","passing_yards","passing_tds",
        "rushing_yards","rushing_tds",
        "receiving_yards","receptions","receiving_tds",
        "field_goals_made"
    ]
    for k in keep:
        if k not in df.columns:
            df[k] = "" if k in ["player_name","player_name_norm","recent_team","opponent_team","position"] else 0
    return df[keep]

def _load_weekly(seasons: List[int]) -> pd.DataFrame:
    frames = []
    for y in seasons:
        try:
            raw = _fetch_weekly_csv(y)
            frames.append(_normalize_week_df(raw))
        except Exception as e:
            print(f"[nfl_bet_engine] warn: failed loading {y}: {e}")
    if not frames:
        return pd.DataFrame(columns=[
            "season","week","player_name","player_name_norm","recent_team","opponent_team","position",
            "completions","attempts","passing_yards","passing_tds",
            "rushing_yards","rushing_tds",
            "receiving_yards","receptions","receiving_tds",
            "field_goals_made"
        ])
    return pd.concat(frames, ignore_index=True)

def _ensure_minimal():
    global _WEEKLY, _SNAPSHOT
    if _WEEKLY is None:
        _WEEKLY = pd.DataFrame(columns=[
            "season","week","player_name","player_name_norm","recent_team","opponent_team","position",
            "completions","attempts","passing_yards","passing_tds",
            "rushing_yards","rushing_tds",
            "receiving_yards","receptions","receiving_tds",
            "field_goals_made"
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
    use_seasons = seasons or SEASONS
    weekly = _load_weekly(use_seasons)

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
# Helpers: position, name matching & baselines
# -----------------------------
def _pos_for_key(metric_key: str) -> str:
    for _, (col, key, pos) in _METRIC_MAP.items():
        if key == metric_key:
            return pos
    return "ANY"

def _league_pos_stats(metric_key: str) -> Tuple[float, float, int]:
    """Position-specific league baseline for the metric."""
    _ensure_minimal()
    assert _WEEKLY is not None
    # find weekly column & position scope
    col = None
    pos_scope = _pos_for_key(metric_key)
    for _, (c, k, _) in _METRIC_MAP.items():
        if k == metric_key:
            col = c
            break
    if col is None or col not in _WEEKLY.columns:
        return 0.0, 0.0, 0

    df = _WEEKLY
    if pos_scope == "QB":
        pool = df[df["position"].astype(str).str.upper() == "QB"]
    elif pos_scope == "RB":
        pool = df[df["position"].astype(str).str.upper() == "RB"]
    elif pos_scope == "WRTE":
        pool = df[df["position"].astype(str).str.upper().isin(["WR","TE"])]
    elif pos_scope == "K":
        pool = df[df["position"].astype(str).str.upper() == "K"]
    else:
        pool = df

    s = pd.to_numeric(pool[col], errors="coerce").dropna()
    if s.empty:
        return 0.0, 0.0, 0
    return float(s.mean()), float(s.std(ddof=0)), int(len(s))

def _last_n_non_null(values: pd.Series, n: int) -> pd.Series:
    vv = pd.to_numeric(values, errors="coerce").dropna().astype(float)
    if vv.empty: return vv
    return vv.iloc[-n:]

def _find_player_rows(df: pd.DataFrame, player: str) -> pd.DataFrame:
    """
    Robust player matching:
      1) exact normalized name
      2) startswith normalized
      3) token containment
      4) last-name + first-initial match
      5) substring fallback
    """
    target = (player or "").strip()
    if not target:
        return df.iloc[0:0]

    t_norm = _normalize_name(target)
    names_norm = df["player_name_norm"].astype(str)
    # 1) exact
    sub = df[names_norm == t_norm]
    if not sub.empty:
        return sub
    # 2) startswith
    sub = df[names_norm.str.startswith(t_norm)]
    if not sub.empty:
        return sub
    # 3) token containment
    toks = t_norm.split()
    if len(toks) >= 2:
        mask = pd.Series(True, index=df.index)
        for tok in toks:
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
    col = None
    for _, (c, k, _) in _METRIC_MAP.items():
        if k == metric_key:
            col = c
            break
    if col is None:
        return 0.0, 0.0, None, None, 0

    df = _WEEKLY
    sub = _find_player_rows(df, player)
    if sub.empty:
        mu_b, sd_b, _ = _league_pos_stats(metric_key)
        pos_guess = _pos_for_key(metric_key)
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
    if metric_key in ("points_for", "points"):
        pass_td = pd.to_numeric(df.get("passing_tds", 0), errors="coerce").fillna(0.0)
        rush_td = pd.to_numeric(df.get("rushing_tds", 0), errors="coerce").fillna(0.0)
        tmp = df.copy()
        tmp["points_for_proxy"] = 6.0 * (pass_td + rush_td)

        if metric_key == "points_for":
            side = tmp[tmp["recent_team"].astype(str).str.upper() == tkey]
            per_game = side.groupby(["season","week","recent_team"])["points_for_proxy"].sum()
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

    _, key, _ = _METRIC_MAP[kind]
    p_mu, p_sd, p_team, p_pos, p_games = _player_stat(player, key)
    o_mu, o_sd, o_games = _team_allowed_stat(opponent_team, key)

    prior = 0.5  # neutral prior

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
        player_rate = max(0.01, p_mu)
        opp_rate = max(0.01, o_mu)
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
    names.sort()
    return names[:max(1, int(limit))]

def list_teams() -> List[str]:
    _ensure_minimal()
    assert _WEEKLY is not None
    rec = _WEEKLY.get("recent_team", pd.Series([], dtype=object)).dropna().astype(str).unique().tolist()
    opp = _WEEKLY.get("opponent_team", pd.Series([], dtype=object)).dropna().astype(str).unique().tolist()
    teams = sorted({*(t.upper() for t in rec), *(t.upper() for t in opp)})
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














