# src/app.py
from __future__ import annotations
import os
from typing import Dict, Any
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from src.service import api as service

app = FastAPI(title="Best Bet NFL API", version="0.1.0")

# --- Frontend URL / CORS setup ---
# Set this in your API project env: WEB_URL = https://best-bet-nfl-web.vercel.app
WEB_URL = os.getenv("WEB_URL", "https://best-bet-nfl-web.vercel.app").strip()
ALLOWED_ORIGINS = [WEB_URL] if WEB_URL else []

# During dev you could allow "*", but in prod lock to your web origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS or ["https://best-bet-nfl-web.vercel.app"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Root redirect to frontend (so visitors don't see a JSON 404) ---
@app.get("/", include_in_schema=False)
def root():
    if WEB_URL:
        return RedirectResponse(WEB_URL, status_code=307)
    return {
        "ok": True,
        "app": "Best Bet NFL API",
        "hint": "Set WEB_URL env var to redirect this root to your frontend.",
        "endpoints": ["/health", "/snapshot", "/refresh-data", "/evaluate/*"]
    }

# --- Health & data management ---
@app.get("/health")
def health():
    return {"ok": True}

@app.post("/refresh-data")
def refresh():
    return service.refresh_data()

# GET alias for Vercel Cron (cron performs GET). See vercel.json.
@app.get("/cron/refresh")
def cron_refresh():
    return service.refresh_data()

@app.get("/snapshot")
def snapshot():
    return service.get_snapshot()

# --- Evaluators ---
@app.post("/evaluate/single")
def evaluate_single(req: Dict[str, Any]):
    return service.evaluate_single(req)  # type: ignore

@app.post("/evaluate/parlay")
def evaluate_parlay(req: Dict[str, Any]):
    return service.evaluate_parlay(req)  # type: ignore

@app.post("/evaluate/batch")
def evaluate_batch(req: Dict[str, Any]):
    return service.evaluate_batch(req)  # type: ignore






