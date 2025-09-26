# src/app.py
from __future__ import annotations
import os
from typing import Dict, Any
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, JSONResponse, PlainTextResponse
from src.service import api as service

app = FastAPI(title="Best Bet NFL API", version="0.1.2")

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

# Vercel Cron (GET)
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
        # Bad inputs -> 400 so the browser still receives JSON, not a network error
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
# Debug helpers (GET)
# -----------------------
@app.get("/debug/ping")
def debug_ping():
    return {"ok": True, "snapshot": service.get_snapshot()}

@app.get("/debug/eval-sample")
def debug_eval_sample():
    # A tiny sample that you can open directly in the browser (no CORS preflight)
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











