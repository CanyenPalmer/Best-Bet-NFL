# src/app_cors.py
# Use this module as your uvicorn entrypoint on Render:
#   uvicorn src.app_cors:app --host 0.0.0.0 --port $PORT
from src.app import app  # re-export your existing FastAPI app
