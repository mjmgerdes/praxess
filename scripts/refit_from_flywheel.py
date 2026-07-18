#!/usr/bin/env python3
"""Flywheel refit: fold logged trajectories back into the world-model priors.

The engine logs every human decision as a (state, action, outcome) tuple in
backend/logs/tuples.jsonl. This job — scheduled weekly in ops/CRON.md — updates
the value function's per-action transition estimates from those trajectories:
actions that humans approve get their estimates sharpened toward observed
frequency; actions repeatedly dismissed decay. That is the autonomous
improvement loop, stated plainly: the model's policy parameters move only in
response to logged, human-approved outcomes — never by silent self-editing.

Usage: python3 scripts/refit_from_flywheel.py
"""

from __future__ import annotations

import datetime as dt
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TUPLES = ROOT / "backend" / "logs" / "tuples.jsonl"
PRIORS = ROOT / "data" / "world_model_priors.json"
PUBLIC = ROOT / "frontend" / "public" / "model" / "world_model_priors.json"

# Map logged decisions onto value-function actions.
DECISION_TO_ACTION = {
    "approve": None,     # resolved per artifact type below
    "answer": "ASK_PATIENT",
    "dismiss": None,
    "edit": None,
}
ARTIFACT_TO_ACTION = {
    "note_addendum": "DRAFT_ADDENDUM",
    "targeted_question": "ASK_PATIENT",
    "verification_task": "REQUEST_RECORD",
}

LEARNING_RATE = 0.1  # conservative: priors move slowly toward observed outcomes


def main() -> int:
    priors = json.loads(PRIORS.read_text())
    if not TUPLES.exists():
        print(f"[dry-run] no flywheel log at {TUPLES}; nothing to refit")
        return 0

    approved: Counter = Counter()
    dismissed: Counter = Counter()
    n = 0
    with TUPLES.open() as f:
        for line in f:
            try:
                t = json.loads(line)
            except json.JSONDecodeError:
                continue
            n += 1
            action = ARTIFACT_TO_ACTION.get(t.get("artifact_type") or "", None) or DECISION_TO_ACTION.get(t.get("decision") or "")
            if not action:
                continue
            if t.get("decision") in ("approve", "answer"):
                approved[action] += 1
            elif t.get("decision") == "dismiss":
                dismissed[action] += 1

    actions = priors["value_function"]["actions"]
    for name, spec in actions.items():
        a, d = approved.get(name, 0), dismissed.get(name, 0)
        if a + d == 0:
            continue
        # Approval share nudges the action's expected value contribution:
        # humans approving an action is evidence its projected state change is
        # real; repeated dismissal is evidence the projection is inflated.
        share = a / (a + d)
        spec["dPApprove"] = round(spec["dPApprove"] * (1 - LEARNING_RATE) + spec["dPApprove"] * share * LEARNING_RATE * 2, 4)
        spec["observed"] = {"approved": a, "dismissed": d}

    priors["flywheel"] = {
        "trajectoriesLogged": n,
        "lastRefit": dt.date.today().isoformat(),
        "byAction": {k: {"approved": approved.get(k, 0), "dismissed": dismissed.get(k, 0)}
                     for k in sorted(set(approved) | set(dismissed))},
    }

    PRIORS.write_text(json.dumps(priors, indent=2) + "\n")
    PUBLIC.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC.write_text(json.dumps(priors, indent=2) + "\n")
    print(f"[ok] refit from {n} trajectories; approved={dict(approved)} dismissed={dict(dismissed)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
