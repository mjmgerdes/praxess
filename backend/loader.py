"""Load synthetic-ambient-fhir-25 encounters into mining layers."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "synthetic-ambient-fhir-25"
JSONL_PATH = DATA_DIR / "synthetic-ambient-fhir-25.jsonl"
SUMMARY_PATH = DATA_DIR / "summary.json"
POLICY_PATH = Path(__file__).resolve().parent / "policy" / "lumbar_mri.json"

PRIMARY_ENCOUNTER_ID = (
    "1ba8eeb9-bc93-7129-4390-0d2ddd560616::1ba8eeb9-bc93-7129-2e7d-8c427e72b964"
)
CURATED = {
    "primary_lbp": PRIMARY_ENCOUNTER_ID,
    "htn_lbp": "6d4fd363-1ddb-74f8-516f-2fdc861cb736::6d4fd363-1ddb-74f8-95dd-b53404f1e107",
    "knee_oa": "73043f9e-3254-a1d3-aa45-b82f0fc6d502::73043f9e-3254-a1d3-ecbd-a0c16f2d8db0",
}


def _fhir_labels(resources: dict[str, Any]) -> dict[str, list[str]]:
    labels: dict[str, list[str]] = {}
    for rtype, items in (resources or {}).items():
        if not isinstance(items, list):
            continue
        out: list[str] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            code = (
                item.get("code")
                or item.get("medicationCodeableConcept")
                or item.get("vaccineCode")
                or {}
            )
            text = None
            if isinstance(code, dict):
                text = code.get("text")
                coding = code.get("coding") or []
                if not text and coding:
                    text = coding[0].get("display")
            if text:
                out.append(text)
        labels[rtype] = out
    return labels


@lru_cache(maxsize=1)
def load_all_records() -> list[dict[str, Any]]:
    if not JSONL_PATH.exists():
        raise FileNotFoundError(f"Dataset not found: {JSONL_PATH}")
    records = [json.loads(line) for line in JSONL_PATH.read_text().splitlines() if line.strip()]
    return records


@lru_cache(maxsize=1)
def load_summary() -> dict[str, Any]:
    return json.loads(SUMMARY_PATH.read_text())


@lru_cache(maxsize=1)
def load_policy() -> dict[str, Any]:
    return json.loads(POLICY_PATH.read_text())


def get_record(encounter_id: str) -> dict[str, Any]:
    for record in load_all_records():
        if record["id"] == encounter_id:
            return record
    raise KeyError(f"Encounter not found: {encounter_id}")


def list_encounters() -> list[dict[str, Any]]:
    summary = load_summary()
    curated_ids = set(CURATED.values())
    out = []
    for row in summary.get("index", []):
        out.append(
            {
                "id": row["id"],
                "date": row.get("date", "")[:10],
                "visit_title": row.get("visit_title", ""),
                "visit_type": row.get("visit_type", ""),
                "transcript_words": row.get("transcript_words"),
                "note_words": row.get("note_words"),
                "fhir_resources": row.get("fhir_resources"),
                "curated": row["id"] in curated_ids,
                "curated_key": next(
                    (k for k, v in CURATED.items() if v == row["id"]), None
                ),
            }
        )
    # Put curated first for demo UX
    out.sort(key=lambda x: (not x["curated"], x["date"]))
    return out


def to_layers(record: dict[str, Any]) -> dict[str, Any]:
    related = record.get("encounter_fhir", {}).get("related_resources", {})
    longitudinal = record.get("patient_context", {}).get("longitudinal_summary", {})
    fhir_text_blob = json.dumps(
        {
            "encounter_conditions": _fhir_labels(related).get("Condition", []),
            "encounter_medications": _fhir_labels(related).get("MedicationRequest", []),
            "encounter_procedures": _fhir_labels(related).get("Procedure", []),
            "encounter_observations": _fhir_labels(related).get("Observation", []),
            "longitudinal_conditions": longitudinal.get("condition_labels", []),
            "longitudinal_medications": longitudinal.get("medication_labels", []),
        },
        indent=2,
    )
    return {
        "id": record["id"],
        "metadata": {
            "date": record.get("metadata", {}).get("date", "")[:10],
            "visit_title": record.get("metadata", {}).get("visit_title", ""),
            "visit_type": record.get("metadata", {}).get("visit_type", ""),
            "patient_id": record.get("metadata", {}).get("patient_id"),
            "encounter_id": record.get("metadata", {}).get("encounter_id"),
        },
        "transcript": record.get("transcript", ""),
        "note": record.get("note", ""),
        "fhir": {
            "related_resources": related,
            "labels": _fhir_labels(related),
            "longitudinal_summary": longitudinal,
            "text_blob": fhir_text_blob,
        },
        "after_visit_summary": record.get("after_visit_summary", ""),
    }


def load_layers(encounter_id: str) -> dict[str, Any]:
    return to_layers(get_record(encounter_id))
