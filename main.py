"""
Root entrypoint for local ASGI runs.

Allows running `uvicorn main:app` from the repository root by proxying to
the actual FastAPI app defined in `apps/api/main.py`.
"""

from apps.api.main import app

__all__ = ["app"]
