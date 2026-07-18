"""Append-only JSONL trajectory log for the world-model flywheel."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

LOG_PATH = Path(__file__).resolve().parent / "logs" / "tuples.jsonl"


def append_tuple(row: dict[str, Any]) -> dict[str, Any]:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "ts": datetime.now(timezone.utc).isoformat(),
        **row,
    }
    with LOG_PATH.open("a") as f:
        f.write(json.dumps(payload) + "\n")
    return payload


def read_tuples(limit: int = 50) -> list[dict[str, Any]]:
    if not LOG_PATH.exists():
        return []
    lines = [l for l in LOG_PATH.read_text().splitlines() if l.strip()]
    out = [json.loads(l) for l in lines[-limit:]]
    return list(reversed(out))
