# src/app.py
from __future__ import annotations
import os
from typing import Dict, Any
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, PlainTextResponse, JSONResponse
from src.service import api as service
from src.engine import nfl_bet_engine as engine

app = FastAPI(title="Best Bet NFL API", version="0.1.3")

# CORS (explicit, preflight-friendly)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=600,
)

# Optional root redirect to your web app (if provided)
_WEB_URL = os.getenv("WEB_URL", "").strip().rstrip("/")
_WEB_URLS = os.getenv("WEB_URLS", "").strip()
_FIRST_WEB = _WEB_URL or (_WEB_URLS.split(",")[0].strip().rstrip("/") if _WEB_URLS else "")

@app.get("/", include_in_schema=False)
def root():
    if _FIRST_WEB:
        return RedirectResponse(_FIRST_WEB, status_code=307)
    return {
        "ok": True,
        "app": "Best Bet NFL API",
        "endpoints": ["/health", "/snapshot", "/refresh-data", "/evaluate/*", "/debug/*"]
    }

@app.get("/health")
def health():
    return {"ok": True}

# --- refresh / snapshot ---
@app.post("/refresh-data")
def refresh():
    try:
        return service.refresh_data()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"refresh-data failed: {e}")

@app.get("/cron/refresh")
def cron_refresh():
    try:
        return service.refresh_data()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"cron refresh failed: {e}")

@app.get("/snapshot")
def snapshot():
    return service.get_snapshot()

# --- OPTIONS preflight (explicit) ---
@app.options("/evaluate/single")
def options_single():
    return PlainTextResponse("ok")

@app.options("/evaluate/parlay")
def options_parlay():
    return PlainTextResponse("ok")

@app.options("/evaluate/batch")
def options_batch():
    return PlainTextResponse("ok")

# --- evaluate ---
@app.post("/evaluate/single")
def evaluate_single(req: Dict[str, Any]):
    """
    Body example:
    {
      "market":"prop","stake":100,"odds":-110,
      "player":"Patrick Mahomes","opponent_team":"BUF",
      "prop_kind":"qb_pass_yards","side":"over","line":275.5
    }
    """
    try:
        return service.evaluate_single(req)  # type: ignore
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"evaluate_single failed: {e}")

@app.post("/evaluate/parlay")
def evaluate_parlay(req: Dict[str, Any]):
    try:
        return service.evaluate_parlay(req)  # type: ignore
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"evaluate_parlay failed: {e}")

@app.post("/evaluate/batch")
def evaluate_batch(req: Dict[str, Any]):
    try:
        return service.evaluate_batch(req)  # type: ignore
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"evaluate_batch failed: {e}")

# -----------------------
# Debug helpers (GET) — zero preflight friction
# -----------------------
@app.get("/debug/ping")
def debug_ping():
    return {"ok": True, "snapshot": service.get_snapshot()}

@app.get("/debug/eval-sample")
def debug_eval_sample():
    sample = {
        "market": "prop",
        "stake": 100.0,
        "odds": -110,
        "player": "Patrick Mahomes",
        "opponent_team": "BUF",
        "prop_kind": "qb_pass_yards",
        "side": "over",
        "line": 275.5
    }
    try:
        return service.evaluate_single(sample)  # type: ignore
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)

@app.get("/debug/players")
def debug_players(prefix: str = Query("", description="Prefix match (case-insensitive)"), limit: int = 25):
    return {"players": engine.list_players(prefix=prefix, limit=limit)}

@app.get("/debug/teams")
def debug_teams():
    return {"teams": engine.list_teams()}

@app.get("/debug/metrics")
def debug_metrics():
    return {"metric_keys": engine.list_metric_keys(), "kind_keys": sorted(list(engine._METRIC_MAP.keys()))}

@app.get("/debug/player-metric")
def debug_player_metric(player: str, metric: str):
    """
    metric can be a 'prop_kind' (e.g., qb_pass_yards) or an internal key (e.g., pass_yds)
    """
    try:
        return engine.get_player_metric(player, metric)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/debug/team-allowed")
def debug_team_allowed(team: str, metric: str):
    """
    metric can be derived from prop kind or be an internal key, e.g.:
      pass_yds, pass_tds, rush_yds, rec, rec_yds, rec_tds, points_for, points
    """
    try:
        return engine.get_team_allowed(team, metric)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/debug/sanity/prop")
def sanity_prop(
    player: str,
    opponent_team: str,
    prop_kind: str,
    line_from: float,
    line_to: float,
    step: float = 5.0
):
    """
    Returns probabilities across a range of lines so you can check monotonic behavior.
    """
    try:
        lo, hi = float(line_from), float(line_to)
        st = max(0.01, float(step))
        if hi < lo:
            lo, hi = hi, lo
        lines = []
        x = lo
        while x <= hi + 1e-9:
            lines.append(round(x, 4))
            x += st

        rows = []
        for L in lines:
            req = {
                "market": "prop",
                "stake": 0.0,
                "odds": -110,
                "player": player,
                "opponent_team": opponent_team,
                "prop_kind": prop_kind,
                "side": "over",
                "line": L
            }
            r = service.evaluate_single(req)  # type: ignore
            p_over = float(r["probability"])
            rows.append({"line": L, "p_over": p_over, "p_under": round(1.0 - p_over, 6)})
        return {"player": player, "opponent_team": opponent_team, "prop_kind": prop_kind, "curve": rows}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"sanity_prop failed: {e}")
