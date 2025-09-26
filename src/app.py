# src/app.py
from __future__ import annotations
from typing import Dict, Any
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from src.service import api as service

app = FastAPI(title="Best Bet NFL API", version="0.1.0")

# During dev allow all; once your web domain is final, lock it down.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/refresh-data")
def refresh():
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



