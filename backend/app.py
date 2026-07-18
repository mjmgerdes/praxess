"""Praxess FastAPI — prior-auth evidence provenance MVP."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Literal, Optional

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=True)
