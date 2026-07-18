"""Deterministic span verification gate over LLM / fixture claims."""

from __future__ import annotations

import re
from typing import Any


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def span_exists(quoted_span: str, source_text: str, *, min_len: int = 12) -> bool:
    """Return True if quoted_span is a whitespace-normalized substring of source_text."""
    q = normalize(quoted_span)
    s = normalize(source_text)
    if not q or len(q) < min_len:
        return False
    return q in s


def layer_text(layers: dict[str, Any], layer: str) -> str:
    if layer == "transcript":
        return layers.get("transcript", "")
    if layer == "note":
        return layers.get("note", "")
    if layer == "fhir":
        return layers.get("fhir", {}).get("text_blob", "")
    if layer == "longitudinal":
        return layers.get("fhir", {}).get("text_blob", "")
    return ""


def verify_evidence_item(
    item: dict[str, Any], layers: dict[str, Any]
) -> dict[str, Any]:
    """Attach verification result; reject unverifiable claims."""
    out = dict(item)
    layer = item.get("source_layer") or item.get("layer")
    span = item.get("quoted_span") or ""
    text = layer_text(layers, layer) if layer else ""
    ok = bool(span and layer and span_exists(span, text))
    out["verified"] = ok
    out["verification"] = {
        "method": "normalized_substring",
        "passed": ok,
        "source_layer": layer,
    }
    if not ok:
        out["status"] = "rejected"
        out["rejection_reason"] = "span_not_found_in_claimed_layer"
    return out


def verify_belief_state(
    state: dict[str, Any], layers: dict[str, Any]
) -> dict[str, Any]:
    """Verify every criterion evidence span; drop rejected from display statuses."""
    criteria = []
    rejected = []
    for crit in state.get("criteria", []):
        c = dict(crit)
        evidence = []
        for ev in crit.get("evidence", []):
            checked = verify_evidence_item(ev, layers)
            if checked.get("verified"):
                evidence.append(checked)
            else:
                rejected.append(checked)
        c["evidence"] = evidence
        # If status relied on rejected spoken/note spans, demote carefully
        if c.get("status") in ("spoken_only", "documented", "patient_reported_unverified"):
            if not evidence:
                c["status"] = "unknown"
                c["confidence"] = 0.0
                c["demoted_reason"] = "all_evidence_failed_verification"
        criteria.append(c)
    out = dict(state)
    out["criteria"] = criteria
    out["rejected_claims"] = rejected
    return out
