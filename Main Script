# nfl_bet_engine.py
from __future__ import annotations
import math, time, functools
from dataclasses import dataclass, field
from typing import Optional, Literal, Dict, Any, Tuple, List
import requests

# -----------------------------
# ESPN client (free endpoints)
# -----------------------------
BASE_SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl"
BASE_WEB  = "https://site.web.api.espn.com/apis/common/v3/sports/football/nfl"

def _get(url: str, params: dict | None = None) -> dict:
    r = requests.get(url, params=params, timeout=12)
    r.raise_for_status()
    return r.json()

@functools.lru_cache(maxsize=128)
def espn_teams() -> List[dict]:
    data = _get(f"{BASE_SITE}/teams")
    teams = []
    for s in data.get("sports", []):
        for l in s.get("leagues", []):
            teams.extend(l.get("teams", []))
    out = []
    for t in teams:
        team = t.get("team") or t
        if team and "id" in team:
            out.append(team)
    return out

@functools.lru_cache(maxsize=256)
def espn_roster(team_id: str | int) -> List[dict]:
    data = _get(f"{BASE_SITE}/teams/{team_id}/roster")
    items = []
    for grp in (data.get("athletes") or []):
        items.extend(grp.get("items", []))
    return items

def _partial_ratio(a: str, b: str) -> int:
    a, b = a.lower(), b.lower()
    if a in b or b in a: return 100
    # longest common substring (tiny)
    n, m = len(a), len(b)
    best = 0
    dp = [[0]*(m+1) for _ in range(n+1)]
    for i in range(n):
        for j in range(m):
            if a[i]==b[j]:
                dp[i+1][j+1] = dp[i][j]+1
                best = max(best, dp[i+1][j+1])
    return int(100 * best / max(1, min(len(a), len(b))))

def _name_score(query_tokens: List[str], full: str) -> float:
    tgt_tokens = full.lower().split()
    overlap = sum(1 for t in query_tokens if t in tgt_tokens) / max(1,len(query_tokens))
    pr = _partial_ratio(" ".join(query_tokens), full) / 100.0
    return 0.6*pr + 0.4*overlap

def find_team_by_name(name: str) -> Optional[dict]:
    q = name.lower().strip()
    best = (0.0, None)
    for t in espn_teams():
        variants = [
            t.get("name",""), t.get("nickname",""), t.get("shortDisplayName",""),
            t.get("displayName",""), f'{t.get("location","")} {t.get("name","")}'
        ]
        for v in variants:
            s = _partial_ratio(q, v)
            if s > best[0]:
                best = (s, t)
    return best[1] if best[0] >= 65 else None

def find_player(name: str) -> Optional[dict]:
    tokens = [x for x in name.lower().split() if x]
    best = (0.0, None)
    for t in espn_teams():
        for p in espn_roster(t["id"]):
            full = (p.get("fullName") or p.get("displayName") or "")
            if not full: continue
            s = _name_score(tokens, full)
            if s > best[0]:
                best = (s, p)
        time.sleep(0.05)  # be polite
    return best[1] if best[0] >= 0.55 else None

@functools.lru_cache(maxsize=512)
def player_gamelog(player_id: str|int, season: int) -> dict:
    return _get(f"{BASE_WEB}/athletes/{player_id}/gamelog", {"season": season})

@functools.lru_cache(maxsize=256)
def team_statistics(team_id: str|int) -> dict:
    return _get(f"{BASE_SITE}/teams/{team_id}/statistics")

# -----------------------------
# Profiles (players/teams)
# -----------------------------
CURRENT_SEASON = 2024  # make dynamic if you want via datetime

@dataclass
class PlayerProfile:
    id: str
    name: str
    position: Optional[str] = None
    team_id: Optional[str] = None
    # rolling means/sd by stat key
    rolling: Dict[str, Tuple[float,float]] = field(default_factory=dict)

@dataclass
class TeamProfile:
    id: str
    name: str
    # allowed stats (avg, sd) by key
    allowed: Dict[str, Tuple[float,float]] = field(default_factory=dict)

def _series_from_gamelog(gl: dict, keys_like: List[str], n: int=8) -> Tuple[float,float]:
    items = gl.get("events", []) or gl.get("items", []) or []
    vals: List[float] = []
    for g in items[:n]:
        stats = g.get("stats") or g.get("statistics") or []
        vv = None
        for s in stats:
            nm = (s.get("name") or s.get("displayName") or "").lower()
            if all(k in nm for k in keys_like):
                try:
                    vv = float(s.get("value"))
                    break
                except: pass
        if vv is not None: vals.append(vv)
    if not vals: return (0.0, 25.0)
    avg = sum(vals)/len(vals)
    var = sum((x-avg)**2 for x in vals)/max(1,len(vals)-1)
    sd = max(6.0, math.sqrt(var))
    return (avg, sd)

def _team_allowed(ts: dict, keys_like: List[str], default_avg: float, default_sd: float) -> Tuple[float,float]:
    avg, sd = None, None
    blocks = ts.get("team", {}).get("statistics", []) or ts.get("statistics", [])
    for cat in blocks:
        for s in cat.get("stats", []) + cat.get("splits", []):
            nm = (s.get("name") or s.get("displayName") or "").lower()
            if all(k in nm for k in keys_like):
                try:
                    avg = float(s.get("value"))
                except: pass
            if "sd" in nm:
                try:
                    sd = float(s.get("value"))
                except: pass
    return (avg or default_avg, sd or default_sd)

@functools.lru_cache(maxsize=256)
def build_player_profile(player_name: str) -> Optional[PlayerProfile]:
    p = find_player(player_name)
    if not p: return None
    pid = str(p["id"])
    team_id = str((p.get("team") or {}).get("id") or "")
    pos = (p.get("position") or {}).get("abbreviation")
    gl = player_gamelog(pid, CURRENT_SEASON)

    # Precompute rolling series we care about
    roll = {
        "rush_yds": _series_from_gamelog(gl, ["rush","yd"]),
        "rush_tds": _series_from_gamelog(gl, ["rush","td"]),
        "rec_yds":  _series_from_gamelog(gl, ["rec","yd"]) or _series_from_gamelog(gl, ["receiving","yd"]),
        "rec_td":   _series_from_gamelog(gl, ["rec","td"]),
        "rec":      _series_from_gamelog(gl, ["rec"]),    # receptions
        "pass_yds": _series_from_gamelog(gl, ["pass","yd"]),
        "pass_td":  _series_from_gamelog(gl, ["pass","td"]),
        "pass_att": _series_from_gamelog(gl, ["pass","att"]),
        "comp":     _series_from_gamelog(gl, ["comp"]),
        "fg_made":  _series_from_gamelog(gl, ["field","goal","made"]) or _series_from_gamelog(gl, ["fg","made"]),
        "kr_yds":   _series_from_gamelog(gl, ["kick","return","yd"]) or _series_from_gamelog(gl, ["return","yd"]),
        "long_rec": _series_from_gamelog(gl, ["long","rec"]),
        "long_rush":_series_from_gamelog(gl, ["long","rush"]),
    }

    return PlayerProfile(id=pid, name=p.get("fullName") or p.get("displayName") or player_name, position=pos, team_id=team_id, rolling=roll)

@functools.lru_cache(maxsize=256)
def build_team_profile(team_name: str) -> Optional[TeamProfile]:
    t = find_team_by_name(team_name)
    if not t: return None
    tid = str(t["id"])
    ts = team_statistics(tid)
    allowed = {
        "rush_yds": _team_allowed(ts, ["rush","yd","allow"], 95.0, 25.0),
        "rush_td":  _team_allowed(ts, ["rush","td","allow"], 0.8, 0.7),
        "pass_yds": _team_allowed(ts, ["pass","yd","allow"], 230.0, 45.0),
        "pass_td":  _team_allowed(ts, ["pass","td","allow"], 1.5, 0.9),
        "comp":     _team_allowed(ts, ["comp","allow"], 22.0, 4.0),
        "att":      _team_allowed(ts, ["pass","att","allow"], 34.0, 6.0),
        "kr_yds":   _team_allowed(ts, ["kick","return","yd","allow"], 55.0, 20.0),
        "points":   _team_allowed(ts, ["points","allow"], 22.0, 7.0),
        "long_rec": _team_allowed(ts, ["long","rec","allow"], 26.0, 8.0),
        "long_rush":_team_allowed(ts, ["long","rush","allow"], 18.0, 6.0),
    }
    return TeamProfile(id=tid, name=t.get("displayName") or team_name, allowed=allowed)

# -----------------------------
# Bets + Probabilities
# -----------------------------
MarketType = Literal["moneyline","spread","total","prop"]

@dataclass
class Bet:
    label: str
    market_type: MarketType
    stake: float
    american_odds: Optional[int] = None   # or use payout_total
    payout_total: Optional[float] = None
    # Targeting:
    prop_kind: Optional[str] = None       # e.g., wr_rec_yards, qb_pass_tds, rb_longest_run
    prop_side: Optional[Literal["over","under"]] = None
    prop_line: Optional[float] = None
    player_name: Optional[str] = None
    opponent_team: Optional[str] = None   # name to resolve allowed stats
    # Derived (filled at runtime)
    hit_probability: Optional[float] = None

    def implied_prob(self) -> float:
        if self.american_odds is not None:
            o = self.american_odds
            return 100/(o+100) if o>0 else abs(o)/(abs(o)+100)
        pt = self.resolve_payout_total()
        return min(0.999, max(0.001, self.stake / pt))

    def resolve_payout_total(self) -> float:
        if self.payout_total is not None:
            return round(self.payout_total, 2)
        if self.american_odds is None:
            raise ValueError("Provide american_odds or payout_total.")
        mult = 1 + (self.american_odds/100.0 if self.american_odds>0 else 100.0/abs(self.american_odds))
        return round(self.stake * mult, 2)

# math helpers
def normal_cdf(x, mu, sigma):
    z = (x-mu)/max(1e-9, sigma)
    return 0.5*(1.0 + math.erf(z / math.sqrt(2)))

def poisson_sf(k_minus_1: float, lam: float) -> float:
    # P(X > k-1) = 1 - CDF(k-1); k can be non-integer line like 0.5
    k = int(math.floor(k_minus_1))
    # sum_{i=0..k} e^{-lam} lam^i / i!
    term = math.exp(-lam)
    cdf = term
    for i in range(1, k+1):
        term *= lam / i
        cdf += term
    return max(0.0, 1.0 - cdf)

def blend_with_prior(p_model: float, p_prior: float, weight_model: float=0.6) -> float:
    # logit blend
    def logit(p): return math.log(max(1e-6,p)/max(1e-6,1-p))
    def inv(z):  return 1.0/(1.0+math.exp(-z))
    z = weight_model*logit(p_model) + (1-weight_model)*logit(p_prior)
    return inv(z)

# -----------------------------
# Feature assembly per prop
# -----------------------------
def _yard_ou_prob(player_mu, player_sd, opp_mu, opp_sd, share, line, side, prior):
    mu = 0.7*player_mu + 0.3*(opp_mu*share)
    var = (0.7**2)*(player_sd**2) + (0.3**2)*((opp_sd*share)**2)
    sigma = max(8.0, math.sqrt(var))
    p = (1.0 - normal_cdf(line, mu, sigma)) if side=="over" else normal_cdf(line, mu, sigma)
    return blend_with_prior(p, prior, 0.6)

def _discrete_ou_poisson(player_rate, opp_rate, line, side, prior):
    lam = max(0.05, 0.65*player_rate + 0.35*opp_rate)
    # P(X >= k) where line often 0.5 or 1.5, so use sf(line-1)
    p_over = poisson_sf(line-1.0, lam)
    p = p_over if side=="over" else 1.0 - p_over
    return blend_with_prior(p, prior, 0.6)

# -----------------------------
# Model registry
# -----------------------------
def predict_hit_probability(b: Bet) -> Optional[float]:
    # Non-prop: fallback to odds implied (you can add team models later)
    if b.market_type != "prop":
        return b.implied_prob()

    prior = b.implied_prob()
    player = build_player_profile(b.player_name or "") if b.player_name else None
    opp    = build_team_profile(b.opponent_team or "") if b.opponent_team else None

    # If we can’t resolve data, use prior
    if not b.prop_kind or not b.prop_side or b.prop_line is None:
        return prior

    kind = b.prop_kind.lower()

    # --- RB yards / longest run / TDs ---
    if kind == "rb_rush_yards":
        if not (player and opp): return prior
        (p_mu,p_sd) = player.rolling["rush_yds"]
        (o_mu,o_sd) = opp.allowed["rush_yds"]
        return _yard_ou_prob(p_mu,p_sd,o_mu,o_sd,share=0.7,line=b.prop_line,side=b.prop_side,prior=prior)

    if kind == "rb_longest_run":
        if not (player and opp): return prior
        (p_mu,p_sd) = player.rolling["long_rush"]
        (o_mu,o_sd) = opp.allowed["long_rush"]
        # longest is spiky -> larger floor sd
        return _yard_ou_prob(p_mu,max(p_sd,10.0),o_mu,max(o_sd,8.0),share=1.0,line=b.prop_line,side=b.prop_side,prior=prior)

    if kind == "rb_rush_tds":
        if not (player and opp): return prior
        (p_mu,_) = player.rolling["rush_tds"]; player_rate = max(0.05, p_mu)   # per game
        (o_mu,_) = opp.allowed["rush_td"];     opp_rate    = max(0.05, o_mu)
        return _discrete_ou_poisson(player_rate, opp_rate, b.prop_line, b.prop_side, prior)

    # --- WR yards / receptions / longest catch / TDs ---
    if kind == "wr_rec_yards":
        if not (player and opp): return prior
        (p_mu,p_sd) = player.rolling["rec_yds"]
        (o_mu,o_sd) = opp.allowed["pass_yds"]
        return _yard_ou_prob(p_mu,p_sd,o_mu,o_sd,share=0.22,line=b.prop_line,side=b.prop_side,prior=prior)

    if kind == "wr_receptions":
        if not (player and opp): return prior
        (p_mu,p_sd) = player.rolling["rec"]
        (o_mu,o_sd) = opp.allowed["comp"]
        return _yard_ou_prob(p_mu,p_sd,o_mu,o_sd,share=0.22,line=b.prop_line,side=b.prop_side,prior=prior)

    if kind == "wr_longest_catch":
        if not (player and opp): return prior
        (p_mu,p_sd) = player.rolling["long_rec"]
        (o_mu,o_sd) = opp.allowed["long_rec"]
        return _yard_ou_prob(p_mu,max(p_sd,10.0),o_mu,max(o_sd,8.0),share=1.0,line=b.prop_line,side=b.prop_side,prior=prior)

    if kind == "wr_rec_tds":
        if not (player and opp): return prior
        (p_mu,_) = player.rolling["rec_td"]; player_rate = max(0.05, p_mu)
        (o_mu,_) = opp.allowed["pass_td"];  opp_rate    = max(0.05, o_mu)
        return _discrete_ou_poisson(player_rate, opp_rate, b.prop_line, b.prop_side, prior)

    # --- QB props ---
    if kind == "qb_pass_yards":
        if not (player and opp): return prior
        (p_mu,p_sd) = player.rolling["pass_yds"]
        (o_mu,o_sd) = opp.allowed["pass_yds"]
        return _yard_ou_prob(p_mu,p_sd,o_mu,o_sd,share=1.0,line=b.prop_line,side=b.prop_side,prior=prior)

    if kind == "qb_pass_tds":
        if not (player and opp): return prior
        (p_mu,_) = player.rolling["pass_td"]; player_rate = max(0.05, p_mu)
        (o_mu,_) = opp.allowed["pass_td"];    opp_rate    = max(0.05, o_mu)
        return _discrete_ou_poisson(player_rate, opp_rate, b.prop_line, b.prop_side, prior)

    if kind == "qb_pass_attempts":
        if not (player and opp): return prior
        (p_mu,p_sd) = player.rolling["pass_att"]
        (o_mu,o_sd) = opp.allowed["att"]
        return _yard_ou_prob(p_mu,p_sd,o_mu,o_sd,share=1.0,line=b.prop_line,side=b.prop_side,prior=prior)

    if kind == "qb_completions":
        if not (player and opp): return prior
        (p_mu,p_sd) = player.rolling["comp"]
        (o_mu,o_sd) = opp.allowed["comp"]
        return _yard_ou_prob(p_mu,p_sd,o_mu,o_sd,share=1.0,line=b.prop_line,side=b.prop_side,prior=prior)

    # --- Kickers / Returns ---
    if kind == "k_fg_made":
        if not (player and opp): return prior
        (p_mu,p_sd) = player.rolling["fg_made"]
        (o_mu,o_sd) = opp.allowed["points"]
        # proxy: more points allowed -> more FG opps
        adj_opp = max(0.5, o_mu/10.0); adj_sd = max(0.5, o_sd/10.0)
        return _yard_ou_prob(p_mu,p_sd,adj_opp,adj_sd,share=1.0,line=b.prop_line,side=b.prop_side,prior=prior)

    if kind == "kick_return_yards":
        if not (player and opp): return prior
        (p_mu,p_sd) = player.rolling["kr_yds"]
        (o_mu,o_sd) = opp.allowed["kr_yds"]
        return _yard_ou_prob(p_mu,p_sd,o_mu,o_sd,share=1.0,line=b.prop_line,side=b.prop_side,prior=prior)

    # Unknown prop -> prior
    return prior

# -----------------------------
# Public API you’ll call
# -----------------------------
def evaluate_bet(b: Bet) -> Dict[str, Any]:
    p = predict_hit_probability(b)
    pt = b.resolve_payout_total()
    profit_if_win = pt - b.stake
    ev = (p or 0)*profit_if_win - (1-(p or 0))*b.stake
    return {
        "label": b.label,
        "market": b.market_type,
        "prop": {"kind": b.prop_kind, "side": b.prop_side, "line": b.prop_line} if b.market_type=="prop" else None,
        "player": b.player_name,
        "opponent": b.opponent_team,
        "stake": round(b.stake,2),
        "payout_if_win": round(pt,2),
        "hit_probability": round((p or 0.0), 4),
        "ev": round(ev,2),
    }
