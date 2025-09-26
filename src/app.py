# src/app.py
from __future__ import annotations
import os
from typing import Dict, Any, List
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from src.service import api as service

app = FastAPI(title="Best Bet NFL API", version="0.1.0")

# --- Web origins / CORS ---
# Provide one or more frontend URLs via WEB_URLS (comma-separated).
# Example:
#   WEB_URLS=https://best-bet-nfl-web.vercel.app,https://best-bet-nfl-xxxxx.vercel.app
_web_urls = os.getenv("WEB_URLS", "").strip()
WEB_URLS: List[str] = [u.strip() for u in _web_urls.split(",") if u.strip()]

# Fallback: allow vercel.app previews if nothing specified (dev convenience).
ALLOW_REGEX = None if WEB_URLS else r"^https://.*vercel\.app$"

app.add_middleware(
    CORSMiddleware,
    allow_origins=WEB_URLS,
    allow_origin_regex=ALLOW_REGEX,  # enables previews if WEB_URLS is empty
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Root redirect to your frontend (if WEB_URLS provided) ---
@app.get("/", include_in_schema=False)
def root():
    if WEB_URLS:
        # Redirect to the first listed frontend URL
        return RedirectResponse(WEB_URLS[0], status_code=307)
    return {
        "ok": True,
        "app": "Best Bet NFL API",
        "hint": "Set WEB_URLS env var (comma-separated) to redirect this root to your frontend(s).",
        "endpoints": ["/health", "/snapshot", "/refresh-data", "/evaluate/*"]
    }

# --- Health & data management ---
@app.get("/health")
def health():
    return {"ok": True}

@app.post("/refresh-data")
def refresh():
    return service.refresh_data()

# GET alias for Vercel Cron (cron performs GET). See vercel.json if configured.
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








