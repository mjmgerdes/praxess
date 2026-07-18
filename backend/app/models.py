"""Pydantic models — the persistent CaseState.

These mirror SOURCE_OF_TRUTH.md §8 one-for-one and serialize to **camelCase**
JSON so the Next.js/TypeScript frontend consumes them without a translation
layer. The §8 TypeScript types are the shared contract; this file is the
Python side of it.
"""

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

# --- §8 string unions ---------------------------------------------------------

EvidenceSource = Literal[
    "clinical_note",
    "transcript",
    "fhir",
    "patient_followup",
    "clinician_followup",
    "external_record",
]

VerificationStatus = Literal[
    "record_verified",
    "clinician_verified",
    "patient_reported",
    "unverified",
    "contradicted",
    "unknown",
]

CoverageReadiness = Literal[
    "submission_ready",
    "partial",
    "needs_verification",
    "unresolved",
    "human_review_required",
]

CriterionStatus = Literal[
    "documented",
    "conversation_enriched",
    "partial",
    "patient_reported",
    "unknown",
    "contradicted",
]

ActionType = Literal[
    "NO_ACTION",
    "ASK_PATIENT",
    "ASK_CLINICIAN",
    "REQUEST_RECORD",
    "DRAFT_ADDENDUM",
    "GENERATE_PACKET",
    "ESCALATE",
]

Actor = Literal["system", "patient", "clinician", "staff"]


class _Base(BaseModel):
    """camelCase JSON on the wire, snake_case in Python; accept either on input."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )


class EvidenceFact(_Base):
    id: str
    criterion_id: str
    concept: str
    value: str
    source_type: EvidenceSource
    exact_quote: Optional[str] = None
    source_location: Optional[str] = None
    verification_status: VerificationStatus
    coverage_readiness: CoverageReadiness
    # Deterministic verifier stamp (Praxess-specific; not in the §8 TS shape but
    # additive and safe for the frontend to ignore). True only after the exact
    # span was found in the claimed source.
    quote_verified: bool = False


class RecommendedAction(_Base):
    id: str
    type: ActionType
    description: str
    actor: Actor
    rationale: str
    expected_state_change: str
    requires_human_approval: bool
    target_criterion_id: Optional[str] = None


class StateTransition(_Base):
    at: str  # ISO-ish label; deterministic (no wall-clock dependence in tests)
    event: str
    detail: str


class CriterionState(_Base):
    id: str
    label: str
    description: str
    status: CriterionStatus
    evidence: List[EvidenceFact] = []
    missing_information: Optional[List[str]] = None
    recommended_action: Optional[RecommendedAction] = None


class CaseState(_Base):
    case_id: str
    requested_service: str
    cpt_code: Optional[str] = None
    payer: Optional[str] = None
    criteria: List[CriterionState] = []
    recommended_action: Optional[RecommendedAction] = None
    coverage_readiness: CoverageReadiness = "unresolved"
    # Honest provenance of the analysis pass: did Claude produce it, or the
    # deterministic golden fixture (offline / no API key)? Never hidden.
    analysis_source: Literal["claude", "golden_fixture"] = "golden_fixture"
    history: List[StateTransition] = []
