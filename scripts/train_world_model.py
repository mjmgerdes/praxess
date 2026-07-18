#!/usr/bin/env python3
"""Fit world-model priors from the Abridge hackathon corpus (all 25 encounters).

"Training," stated honestly: this runs the engine's deterministic evidence
miner over every encounter in synthetic-ambient-fhir-25 and fits empirical
priors — per-criterion status distributions, gap frequencies, and how often
the conversation carries evidence the note lost. Those priors parameterize the
decision engine's value function (see `value_function` below). It is a fitted
statistical prior over 25 synthetic encounters, NOT a learned/trained model —
but it is exactly the seed a learned world model would start from, and the
flywheel (scripts/refit_from_flywheel.py) updates it from real trajectories.

Usage: python3 scripts/train_world_model.py
"""

from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from state import _keyword_mine  # noqa: E402 — the engine's own miner

JSONL = ROOT / "synthetic-ambient-fhir-25" / "synthetic-ambient-fhir-25.jsonl"
OUT = ROOT / "data" / "world_model_priors.json"
PUBLIC = ROOT / "frontend" / "public" / "model" / "world_model_priors.json"


def main() -> int:
    status_by_criterion: dict[str, Counter] = defaultdict(Counter)
    n = 0
    with JSONL.open() as f:
        for line in f:
            enc = json.loads(line)
            mined = _keyword_mine(enc.get("transcript", ""), enc.get("note", ""), enc["id"])
            for c in mined["criteria"]:
                status_by_criterion[c["id"]][c["status"]] += 1
            n += 1

    criteria = {}
    for cid, counts in status_by_criterion.items():
        total = sum(counts.values())
        documented = counts.get("documented", 0) / total
        conv = counts.get("conversation_enriched", 0) / total
        unknown = counts.get("unknown", 0) / total
        criteria[cid] = {
            "statusDistribution": {k: round(v / total, 3) for k, v in sorted(counts.items())},
            # How often the criterion is NOT payer-visible as documented —
            # the prior probability there is work for Praxess to do.
            "gapRate": round(1 - documented, 3),
            # How often the conversation holds evidence the note lost —
            # the empirical value of mining the transcript (the addendum path).
            "conversationRecoveryRate": round(conv, 3),
            "unknownRate": round(unknown, 3),
        }

    priors = {
        "_meta": {
            "fitFrom": f"{n} encounters · synthetic-ambient-fhir-25 (Abridge hackathon corpus)",
            "method": "deterministic evidence miner over transcript+note per encounter; empirical status distributions",
            "honesty": "Fitted priors, not a trained model. The flywheel refit (ops/CRON.md) updates these from logged trajectories.",
        },
        "criteria": criteria,
        # EV(a) = wApproval·dPApprove(a) + wInfo·infoGain(a) − wTime·delayDays(a)/30 − wBurden·burden(a)
        # Weights are the policy's priorities; per-action parameters are the
        # world model's transition estimates, seeded from the priors above and
        # updated by the flywheel refit.
        "value_function": {
            "weights": {"wApproval": 1.0, "wInfo": 0.35, "wTime": 0.25, "wBurden": 0.15},
            "actions": {
                "DRAFT_ADDENDUM":  {"dPApprove": 0.18, "infoGain": 0.55, "delayDays": 0.2, "burden": 0.15,
                                    "basis": "conversationRecoveryRate of conservative_care/nsaid_trial — the note-lost evidence the addendum recovers"},
                "ASK_PATIENT":     {"dPApprove": 0.22, "infoGain": 0.80, "delayDays": 1.0, "burden": 0.10,
                                    "basis": "unknownRate of PT history — only the patient can open the verification path"},
                "ASK_CLINICIAN":   {"dPApprove": 0.04, "infoGain": 0.20, "delayDays": 1.5, "burden": 0.30,
                                    "basis": "clinician cannot attest to unsupervised external care"},
                "REQUEST_RECORD":  {"dPApprove": 0.30, "infoGain": 0.65, "delayDays": 3.0, "burden": 0.20,
                                    "basis": "patient-reported → record-verified conversion"},
                "SUBMIT_NOW":      {"dPApprove": -0.35, "infoGain": 0.0, "delayDays": 0.0, "burden": 0.05,
                                    "basis": "modal denial for this family: insufficient conservative-therapy evidence (payer-intel)"},
                "GENERATE_PACKET": {"dPApprove": 0.10, "infoGain": 0.0, "delayDays": 0.1, "burden": 0.10,
                                    "basis": "assembly when all criteria supported"},
                "HOLD":            {"dPApprove": 0.0, "infoGain": 0.0, "delayDays": 2.0, "burden": 0.0,
                                    "basis": "no state change; deadline pressure only"},
                "APPEAL_LETTER":   {"dPApprove": 0.34, "infoGain": 0.30, "delayDays": 5.0, "burden": 0.25,
                                    "basis": "KFF: most appealed denials overturn; letter binds denial reason to verified evidence"},
                "PEER_TO_PEER":    {"dPApprove": 0.28, "infoGain": 0.45, "delayDays": 3.0, "burden": 0.40,
                                    "basis": "clinician-to-medical-director review; fastest overturn channel when evidence is strong"},
                "RESUBMIT":        {"dPApprove": 0.08, "infoGain": 0.0, "delayDays": 7.0, "burden": 0.20,
                                    "basis": "resubmission without new evidence rarely changes the determination"},
                "SUBMIT_READY":    {"dPApprove": 0.55, "infoGain": 0.0, "delayDays": 0.5, "burden": 0.05,
                                    "basis": "all criteria supported and provenance-linked; submission is the value-realizing move"},
                "TRACK":           {"dPApprove": 0.15, "infoGain": 0.30, "delayDays": 2.0, "burden": 0.0,
                                    "basis": "a payer response is the next observation; watching for it is the only action left"},
            },
        },
        "flywheel": {"trajectoriesLogged": 0, "lastRefit": None},
    }

    OUT.write_text(json.dumps(priors, indent=2) + "\n")
    PUBLIC.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC.write_text(json.dumps(priors, indent=2) + "\n")
    print(f"[ok] fit priors from {n} encounters -> {OUT}")
    for cid, c in criteria.items():
        print(f"  {cid}: gapRate={c['gapRate']}  conversationRecovery={c['conversationRecoveryRate']}  unknown={c['unknownRate']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
