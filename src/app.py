# src/app.py
from __future__ import annotations
import os
from typing import Dict, Any
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from src.service import api as service

app = FastAPI(title="Best Bet NFL API", version="0.1.0")

# --------------------------------------------------------------------
# CORS: open for now to eliminate CORS as a cause of "failed to fetch".
# Once everything is working, we can lock this down to your web origin.
# --------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],      # <-- temporarily allow all
    allow_methods=["*"],
    allow_headers=["*"],
)

# Optional: redirect "/" to your frontend if WEB_URL or WEB_URLS is set.
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
        "hint": "Set WEB_URL or WEB_URLS env var to redirect this root to your frontend.",
        "endpoints": ["/health", "/snapshot", "/refresh-data", "/evaluate/*"]
    }

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/refresh-data")
def refresh():
    return service.refresh_data()

# GET alias for Vercel Cron (cron performs GET)
@app.get("/cron/refresh")
def cron_refresh():
    return service.refresh_data()

@app.get("/snapshot")
def snapshot():
    return service.get_snapshot()

@app.post("/evaluate/single")
def evaluate_single(req: Dict[str, Any]):
    return service.evaluate_single(req)  # type: ignore

@app.post("/evaluate/parlay")
def evaluate_parlay(req: Dict[str, Any]):
    return service.evaluate_parlay(req)  # type: ignore

@app.post("/evaluate/batch")
def evaluate_batch(req: Dict[str, Any]):
    return service.evaluate_batch(req)  # type: ignore










