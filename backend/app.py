"""Praxess FastAPI — prior-auth evidence provenance MVP."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Literal, Optional

from dotenv import load_dotenv

# Load .env when present (local dev). In Railway the vars come from the
# environment directly, so a missing .env file is fine.
_env_path = Path(__file__).resolve().parent.parent / ".env"
if _env_path.exists():
    load_dotenv(_env_path)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from actions import pending_artifacts
from loader import PRIMARY_ENCOUNTER_ID, list_encounters, load_layers, load_policy
from log import read_tuples
from mine import live_mine_available
from state import analyze_encounter, analyze_transcript, apply_decision, default_encounter_id, get_session
from trajectories import get_trajectories

app = FastAPI(
    title="Praxess",
    description="Evidence-provenance prior auth from the ambient conversation",
    version="0.1.0",
)

# CORS — allow any origin so the frontend can live on a different Railway
# service URL during development or staging. Tighten in production if needed.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    encounter_id: str = Field(default=PRIMARY_ENCOUNTER_ID)
    session_id: str = "default"
    live_mine: bool = False


class DecideRequest(BaseModel):
    session_id: str = "default"
    criterion_id: str
    decision: Literal["approve", "dismiss", "edit", "answer"]
    edit: Optional[str] = None
    answer: Optional[str] = None


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "live_mine_available": live_mine_available(),
        "default_encounter_id": default_encounter_id(),
        "policy_id": load_policy().get("id"),
    }


@app.get("/api/encounters")
def encounters() -> dict[str, Any]:
    return {
        "encounters": list_encounters(),
        "default_encounter_id": default_encounter_id(),
        "policy": load_policy(),
    }


@app.get("/api/encounter")
def encounter_detail(encounter_id: str) -> dict[str, Any]:
    """Transcript/note/metadata for one encounter — no analysis, instant."""
    try:
        layers = load_layers(encounter_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {
        "id": layers["id"],
        "metadata": layers["metadata"],
        "transcript": layers["transcript"],
        "note": layers["note"],
    }


class AnalyzeTranscriptRequest(BaseModel):
    transcript: str
    note: Optional[str] = ""
    session_id: str = "default"


class DiarizeRequest(BaseModel):
    transcript: str


@app.post("/api/diarize")
def diarize_endpoint(req: DiarizeRequest) -> dict[str, Any]:
    """Label speaker turns in a raw transcript using Claude."""
    if not req.transcript or len(req.transcript.strip()) < 10:
        raise HTTPException(status_code=400, detail="transcript too short")
    try:
        from mine import diarize
        lines = diarize(req.transcript.strip())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return {"lines": lines, "live": live_mine_available()}


@app.post("/api/analyze_transcript")
def analyze_transcript_endpoint(req: AnalyzeTranscriptRequest) -> dict[str, Any]:
    if not req.transcript or len(req.transcript.strip()) < 20:
        raise HTTPException(status_code=400, detail="transcript must be at least 20 characters")
    try:
        state = analyze_transcript(
            req.transcript.strip(),
            note=req.note or "",
            session_id=req.session_id,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return {
        "state": state,
        "pending_artifacts": pending_artifacts(state),
        "tuples": read_tuples(20),
        "trajectories": get_trajectories(state),
    }


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest) -> dict[str, Any]:
    try:
        if req.live_mine and not live_mine_available():
            raise HTTPException(
                status_code=400,
                detail="live_mine requested but ANTHROPIC_API_KEY is not set",
            )
        state = analyze_encounter(
            req.encounter_id,
            session_id=req.session_id,
            use_live_mine=req.live_mine,
        )
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    return {
        "state": state,
        "pending_artifacts": pending_artifacts(state),
        "tuples": read_tuples(20),
        "trajectories": get_trajectories(state),
    }


@app.post("/api/decide")
def decide(req: DecideRequest) -> dict[str, Any]:
    try:
        state = apply_decision(
            session_id=req.session_id,
            criterion_id=req.criterion_id,
            decision=req.decision,
            edit=req.edit,
            answer=req.answer,
        )
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    return {
        "state": state,
        "pending_artifacts": pending_artifacts(state),
        "tuples": read_tuples(20),
        "trajectories": get_trajectories(state),
    }


@app.get("/api/session")
def session(session_id: str = "default") -> dict[str, Any]:
    state = get_session(session_id)
    if not state:
        raise HTTPException(status_code=404, detail="No active session")
    return {
        "state": state,
        "pending_artifacts": pending_artifacts(state),
        "tuples": read_tuples(20),
        "trajectories": get_trajectories(state),
    }


@app.get("/api/trajectories")
def trajectories(session_id: str = "default") -> dict[str, Any]:
    """Return ranked trajectory rollouts for the current session state."""
    state = get_session(session_id)
    if not state:
        raise HTTPException(status_code=404, detail="No active session — call /api/analyze first")
    return get_trajectories(state)


# ── Static frontend (built by `npm run build` in frontend/) ──────────────────
# Railway build step runs `npm run build` then starts uvicorn. The FastAPI
# process serves /api/* routes above and falls back to the React SPA for
# everything else. This means a single Railway service handles both tiers.
_STATIC_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"

if _STATIC_DIR.is_dir():
    # Mount /assets (Vite hashed bundles) as a static directory.
    _assets = _STATIC_DIR / "assets"
    if _assets.is_dir():
        app.mount("/assets", StaticFiles(directory=str(_assets)), name="assets")

    # Serve any other static file that exists (favicon, icons, public/).
    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str) -> FileResponse:
        candidate = _STATIC_DIR / full_path
        if candidate.is_file():
            return FileResponse(str(candidate))
        # All non-file paths → index.html (React Router / SPA)
        return FileResponse(str(_STATIC_DIR / "index.html"))


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=False)
