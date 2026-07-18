"""analyzeCriteria — map payer criteria onto the evidence, then verify.

Two producers of the *proposed* analysis:

  * Claude (when ANTHROPIC_API_KEY is set) — interprets transcript/note/FHIR and
    returns structured, schema-shaped evidence per criterion. Claude proposes;
    it never gets the final say on whether its quote exists.
  * a deterministic golden fixture (offline / no key) — encodes the expected
    analysis from data/demo-plan.md so the full state→action→replan→artifact
    loop, and the acceptance test, run with no network.

Whichever produced it, every proposed fact is then run through the deterministic
verifier (verify.py). A criterion left with zero verified facts is forced to
`unknown` — we never display a status we couldn't source.
"""

from __future__ import annotations

import os
from typing import List, Tuple

from .models import CriterionState, EvidenceFact
from .sources import Encounter
from .verify import verify_and_filter

AnalysisSource = str  # "claude" | "golden_fixture"


# --- deterministic golden fixture (data/demo-plan.md) -------------------------

def _fact(
    cid: str,
    n: int,
    concept: str,
    value: str,
    source_type: str,
    quote: str,
    verification: str,
) -> EvidenceFact:
    return EvidenceFact(
        id=f"{cid}::{source_type}::{n}",
        criterion_id=cid,
        concept=concept,
        value=value,
        source_type=source_type,  # type: ignore[arg-type]
        exact_quote=quote,
        verification_status=verification,  # type: ignore[arg-type]
        coverage_readiness="partial",
    )


def golden_criteria(policy: dict) -> List[CriterionState]:
    """Expected pre-observation analysis, straight from demo-plan.md."""
    by_id = {c["id"]: c for c in policy["criteria"]}

    def base(cid: str, status: str, facts, missing=None) -> CriterionState:
        c = by_id[cid]
        return CriterionState(
            id=cid,
            label=c["label"],
            description=c["description"],
            status=status,  # type: ignore[arg-type]
            evidence=facts,
            missing_information=missing,
        )

    return [
        base(
            "LBP-1",
            "documented",
            [
                _fact("LBP-1", 0, "symptom_duration", "~6 years", "clinical_note",
                      "present about six years", "clinician_verified"),
                _fact("LBP-1", 1, "symptom_duration", "~6 years", "transcript",
                      "going on six years now", "unverified"),
                _fact("LBP-1", 2, "chronicity", "chronic LBP on chart", "fhir",
                      "Chronic low back pain (finding)", "record_verified"),
            ],
        ),
        base(
            "LBP-2",
            "partial",
            [
                _fact("LBP-2", 0, "conservative_therapy", "stretches taught (provider/dates unknown)",
                      "clinical_note", "previously taught stretches", "clinician_verified"),
                _fact("LBP-2", 1, "conservative_therapy", "self-reported benefit from stretching",
                      "transcript", "Stretching helps some", "unverified"),
            ],
            missing=[
                "Provider / facility that directed the therapy",
                "Start and end dates",
                "Duration (must be >= 6 weeks in the preceding 6 months)",
            ],
        ),
        base(
            "LBP-3",
            "conversation_enriched",
            [
                _fact("LBP-3", 0, "pharmacologic_mgmt", "acetaminophen scheduled",
                      "clinical_note", "Acetaminophen 325 mg oral tablets", "clinician_verified"),
                _fact("LBP-3", 1, "prior_pharmacologic_lapse", "prior meds lapsed at insurance change",
                      "transcript", "ran out of everything months ago", "unverified"),
            ],
        ),
        base(
            "LBP-4",
            "documented",
            [
                _fact("LBP-4", 0, "red_flag_screen", "denies red-flag/neuro symptoms",
                      "clinical_note",
                      "denies radicular pain, numbness, tingling, weakness, and bowel or bladder dysfunction",
                      "clinician_verified"),
                _fact("LBP-4", 1, "neuro_exam", "neurovascularly intact, gait normal",
                      "clinical_note", "lower extremities neurovascularly intact; gait normal",
                      "clinician_verified"),
            ],
        ),
        base(
            "LBP-5",
            "conversation_enriched",
            [
                _fact("LBP-5", 0, "functional_impairment", "aggravated by sitting/stairs",
                      "clinical_note", "aggravated by prolonged sitting", "clinician_verified"),
                _fact("LBP-5", 1, "functional_impairment", "evening pain 5-6/10",
                      "transcript", "five or six", "unverified"),
            ],
        ),
    ]


# --- public entrypoint --------------------------------------------------------

def analyze_criteria(
    encounter: Encounter, policy: dict
) -> Tuple[List[CriterionState], AnalysisSource]:
    if os.environ.get("ANTHROPIC_API_KEY"):
        try:
            from .claude_client import analyze_with_claude

            criteria = analyze_with_claude(encounter, policy)
            source: AnalysisSource = "claude"
        except Exception as exc:  # noqa: BLE001 — demo must degrade, not crash
            print(f"[analyze] Claude path failed ({exc!r}); using golden fixture.")
            criteria = golden_criteria(policy)
            source = "golden_fixture"
    else:
        criteria = golden_criteria(policy)
        source = "golden_fixture"

    _verify_all(encounter, criteria)
    return criteria, source


def _verify_all(encounter: Encounter, criteria: List[CriterionState]) -> None:
    """Run the deterministic verifier over every criterion, in place.

    Rejected (unverifiable) facts are dropped. A criterion with no surviving
    verified fact is forced to `unknown` — we never show an unsourced status.
    """
    sources = encounter.sources()
    for crit in criteria:
        verified, rejected = verify_and_filter(crit.evidence, sources)
        crit.evidence = verified
        if rejected:
            print(
                f"[verify] {crit.id}: dropped {len(rejected)} unverifiable "
                f"fact(s): {[r.exact_quote for r in rejected]}"
            )
        if not verified:
            crit.status = "unknown"
