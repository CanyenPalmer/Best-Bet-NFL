# src/app.py
from __future__ import annotations
import os
from typing import Dict, Any, List
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from src.service import api as service

app = FastAPI(title="Best Bet NFL API", version="0.1.0")

# -------------------------------------------------------
# CORS / Frontend origins
# -------------------------------------------------------
# Accept comma-separated frontend URLs in WEB_URLS.
# IMPORTANT: do NOT include trailing slashes in WEB_URLS values.
_raw = os.getenv("WEB_URLS", "").strip()
WEB_URLS: List[str] = []
if _raw:
    for u in _raw.split(","):
        u = u.strip()
        if u.endswith("/"):
            u = u[:-1]  # normalize: strip trailing slash so it matches the Origin header
        if u:
            WEB_URLS.append(u)

# Always allow vercel.app previews (handy during development)
# This works *in addition to* explicit WEB_URLS.
ALLOW_REGEX = r"^https://.*\.vercel\.app$"

app.add_middleware(
    CORSMiddleware,
    allow_origins=WEB_URLS,          # exact matches (no trailing slash)
    allow_origin_regex=ALLOW_REGEX,  # any *.vercel.app preview
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------------------------------------------
# Root redirect (to the first frontend, if provided)
# -------------------------------------------------------
@app.get("/", include_in_schema=False)
def root():
    if WEB_URLS:
        return RedirectResponse(WEB_URLS[0], status_code=307)
    return {
        "ok": True,
        "app": "Best Bet NFL API",
        "hint": "Set WEB_URLS env var (comma-separated, no trailing slashes) to redirect this root to your frontend(s).",
        "endpoints": ["/health", "/snapshot", "/refresh-data", "/evaluate/*"]
    }

# -------------------------------------------------------
# Health & data
# -------------------------------------------------------
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

# -------------------------------------------------------
# Evaluators
# -------------------------------------------------------
@app.post("/evaluate/single")
def evaluate_single(req: Dict[str, Any]):
    return service.evaluate_single(req)  # type: ignore

@app.post("/evaluate/parlay")
def evaluate_parlay(req: Dict[str, Any]):
    return service.evaluate_parlay(req)  # type: ignore

@app.post("/evaluate/batch")
def evaluate_batch(req: Dict[str, Any]):
    return service.evaluate_batch(req)  # type: ignore









