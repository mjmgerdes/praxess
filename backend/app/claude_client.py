"""Anthropic client — the real analyzeCriteria path (SOURCE_OF_TRUTH §13).

Claude is shown the note, transcript, and normalized FHIR plus the payer
criteria, and must return structured evidence per criterion via a tool schema.
It interprets language and maps evidence to criteria; it does NOT decide whether
its own quote exists (verify.py does) and it cannot insert a fact into state
without a quote that survives verification.

Model is configurable via PRAXESS_MODEL (default: claude-sonnet-5).
"""

from __future__ import annotations

import json
import os
from typing import List

from .models import CriterionState, EvidenceFact
from .sources import Encounter

DEFAULT_MODEL = os.environ.get("PRAXESS_MODEL", "claude-sonnet-5")

_SYSTEM = """You are the evidence-analysis component of Praxess, a prior-authorization \
preparation tool. You compare a payer's medical-necessity criteria against a \
clinical encounter (visit transcript, final note, and normalized FHIR chart).

Rules you must follow exactly:
- For each criterion, decide a status: documented, conversation_enriched, partial, \
unknown, or contradicted.
- Every supporting fact MUST include an exactQuote copied verbatim (character for \
character) from ONE source: clinical_note, transcript, or fhir. Do not paraphrase \
inside exactQuote. If you cannot quote it, do not assert it.
- "documented": the note or FHIR clearly supports the criterion on its own.
- "conversation_enriched": the note carries the general fact and the transcript adds \
useful context.
- "partial": some evidence exists but a REQUIRED detail is missing (e.g. therapy was \
attempted but its provider/duration/dates are absent). List what is missing.
- "unknown": no source resolves it. Never label a criterion false — unknown is not no.
- Do not stretch vague evidence into a stronger status. Under-claim, never over-claim.
"""

_TOOL = {
    "name": "record_analysis",
    "description": "Return the per-criterion evidence analysis.",
    "input_schema": {
        "type": "object",
        "properties": {
            "criteria": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "status": {
                            "type": "string",
                            "enum": [
                                "documented",
                                "conversation_enriched",
                                "partial",
                                "unknown",
                                "contradicted",
                            ],
                        },
                        "missingInformation": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                        "evidence": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "concept": {"type": "string"},
                                    "value": {"type": "string"},
                                    "sourceType": {
                                        "type": "string",
                                        "enum": ["clinical_note", "transcript", "fhir"],
                                    },
                                    "exactQuote": {"type": "string"},
                                },
                                "required": ["concept", "value", "sourceType", "exactQuote"],
                            },
                        },
                    },
                    "required": ["id", "status", "evidence"],
                },
            }
        },
        "required": ["criteria"],
    },
}


def _user_prompt(encounter: Encounter, policy: dict) -> str:
    crit_lines = "\n".join(
        f"- {c['id']} ({c['label']}): {c['description']}" for c in policy["criteria"]
    )
    return f"""PAYER CRITERIA for {policy['requestedService']} (CPT {policy.get('cptCode')}):
{crit_lines}

=== CLINICAL NOTE ===
{encounter.note}

=== VISIT TRANSCRIPT ===
{encounter.transcript}

=== NORMALIZED FHIR ===
{encounter.fhir_text}

Analyze each criterion. Call record_analysis with the result."""


def analyze_with_claude(encounter: Encounter, policy: dict) -> List[CriterionState]:
    from anthropic import Anthropic

    client = Anthropic()
    resp = client.messages.create(
        model=DEFAULT_MODEL,
        max_tokens=4096,
        system=_SYSTEM,
        tools=[_TOOL],
        tool_choice={"type": "tool", "name": "record_analysis"},
        messages=[{"role": "user", "content": _user_prompt(encounter, policy)}],
    )

    payload = None
    for block in resp.content:
        if getattr(block, "type", None) == "tool_use" and block.name == "record_analysis":
            payload = block.input
            break
    if payload is None:
        raise RuntimeError("Claude did not return a record_analysis tool call")

    by_id = {c["id"]: c for c in policy["criteria"]}
    out: List[CriterionState] = []
    for cr in payload["criteria"]:
        cid = cr["id"]
        pol = by_id.get(cid, {"label": cid, "description": ""})
        facts: List[EvidenceFact] = []
        for i, e in enumerate(cr.get("evidence", [])):
            facts.append(
                EvidenceFact(
                    id=f"{cid}::{e['sourceType']}::{i}",
                    criterion_id=cid,
                    concept=e["concept"],
                    value=e["value"],
                    source_type=e["sourceType"],
                    exact_quote=e["exactQuote"],
                    # Provenance of the *quote* is decided by verify.py. Initial
                    # clinical verification status is conservative.
                    verification_status="unverified",
                    coverage_readiness="partial",
                )
            )
        out.append(
            CriterionState(
                id=cid,
                label=pol["label"],
                description=pol["description"],
                status=cr["status"],
                evidence=facts,
                missing_information=cr.get("missingInformation"),
            )
        )
    return out
