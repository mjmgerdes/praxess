"""Artifact helpers (addenda / targeted questions) — mostly fixture-driven in MVP."""

from __future__ import annotations

from typing import Any


def pending_artifacts(state: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for c in state.get("criteria", []):
        art = c.get("artifact")
        if not art:
            continue
        if art.get("status") in ("pending_approval", "pending_answer"):
            out.append({**art, "criterion_id": c["id"], "criterion_label": c.get("label")})
    return out
