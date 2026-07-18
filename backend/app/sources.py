"""Load the encounter + payer policy and normalize them into searchable sources.

The engine reasons over exactly three text sources plus follow-up channels:

    clinical_note  -> encounter["note"]
    transcript     -> encounter["transcript"]
    fhir           -> a normalized text blob (see build_fhir_source)

`patient_followup`, `clinician_followup`, and `external_record` are not present
at load time — they arrive later via applyObservation.

Everything Claude is shown, and everything the deterministic verifier searches,
comes from here. Keeping the FHIR blob as human-readable text (rather than raw
JSON) means a Claude-quoted span like "Chronic low back pain (finding)" can be
verified with the same exact-substring search used for the note and transcript.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict

DATA_DIR = Path(__file__).resolve().parents[2] / "data"


@dataclass
class Encounter:
    case_id: str
    note: str
    transcript: str
    fhir_text: str
    after_visit_summary: str
    raw: dict

    def sources(self) -> Dict[str, str]:
        """Map EvidenceSource -> searchable text (only load-time sources)."""
        return {
            "clinical_note": self.note,
            "transcript": self.transcript,
            "fhir": self.fhir_text,
        }


def build_fhir_source(enc: dict) -> str:
    """Flatten the FHIR into a compact, verifiable text block.

    Includes the encounter-scoped conditions/meds AND the longitudinal chart
    condition/medication labels. The longitudinal condition list is where the
    chronic-LBP chart background actually lives ("Chronic low back pain
    (finding)", "Chronic pain (finding)") — the encounter Condition resources
    for this visit are only Unemployed/Stress/Gingivitis.
    """
    lines: list[str] = []
    fhir = enc.get("encounter_fhir", {})
    rr = fhir.get("related_resources", {}) or {}

    def _label(resource: dict) -> str | None:
        r = resource.get("resource", resource)
        code = r.get("code") or r.get("medicationCodeableConcept") or {}
        text = code.get("text")
        if not text:
            coding = code.get("coding") or [{}]
            text = coding[0].get("display")
        status = None
        cs = r.get("clinicalStatus") or {}
        if cs:
            status = (cs.get("coding") or [{}])[0].get("code")
        status = status or r.get("status")
        if not text:
            return None
        return f"{text}" + (f" [{status}]" if status else "")

    lines.append("# Encounter-scoped FHIR")
    for cond in rr.get("Condition", []):
        lab = _label(cond)
        if lab:
            lines.append(f"Condition: {lab}")
    for med in rr.get("MedicationRequest", []):
        lab = _label(med)
        if lab:
            lines.append(f"MedicationRequest: {lab}")

    long = (enc.get("patient_context") or {}).get("longitudinal_summary") or {}
    cond_labels = long.get("condition_labels") or []
    med_labels = long.get("medication_labels") or []
    if cond_labels:
        lines.append("")
        lines.append("# Longitudinal chart — active/known condition labels")
        for lab in cond_labels:
            lines.append(f"Condition: {lab}")
    if med_labels:
        lines.append("")
        lines.append("# Longitudinal chart — medication labels")
        for lab in med_labels:
            lines.append(f"Medication: {lab}")

    return "\n".join(lines)


def load_encounter(path: str | Path | None = None) -> Encounter:
    p = Path(path) if path else DATA_DIR / "encounter.json"
    enc = json.loads(p.read_text())
    return Encounter(
        case_id=enc.get("id", "unknown-case"),
        note=enc.get("note", ""),
        transcript=enc.get("transcript", ""),
        fhir_text=build_fhir_source(enc),
        after_visit_summary=enc.get("after_visit_summary", ""),
        raw=enc,
    )


def load_policy(path: str | Path | None = None) -> dict:
    p = Path(path) if path else DATA_DIR / "payer-policy.json"
    return json.loads(p.read_text())
