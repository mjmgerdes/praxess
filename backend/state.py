"""In-memory provenance belief state + completeness scoring."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

from loader import CURATED, PRIMARY_ENCOUNTER_ID, load_layers, load_policy
from verify import verify_belief_state

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"

_SESSIONS: dict[str, dict[str, Any]] = {}

# Statuses that count as "addressed" for the score
_ADDRESSED = {"documented", "patient_reported"}
# Statuses that need action
_RECOVERABLE = {"conversation_enriched", "partial"}
# Statuses still open
_OPEN = {"unknown", "patient_reported_unverified"}


def fixture_key_for(encounter_id: str) -> str | None:
    for key, eid in CURATED.items():
        if eid == encounter_id:
            return key
    return None


def load_fixture(key: str) -> dict[str, Any]:
    path = FIXTURES_DIR / f"belief_state_{key}.json"
    if not path.exists():
        raise FileNotFoundError(f"No fixture for {key}: {path}")
    return json.loads(path.read_text())


def compute_completeness(criteria: list[dict[str, Any]]) -> dict[str, Any]:
    addressed = sum(1 for c in criteria if c.get("status") in _ADDRESSED)
    recoverable = sum(1 for c in criteria if c.get("status") in _RECOVERABLE)
    open_ = sum(1 for c in criteria if c.get("status") in _OPEN)
    patient_rep = sum(1 for c in criteria if c.get("status") == "patient_reported")
    total = len(criteria)
    return {
        "addressed": addressed,
        "recoverable": recoverable,
        "open": open_,
        "patient_reported": patient_rep,
        "total": total,
        "score_pct": int(round(100 * addressed / total)) if total else 0,
        # convenience counts by status
        "by_status": _count_by_status(criteria),
    }


def _count_by_status(criteria: list[dict[str, Any]]) -> dict[str, int]:
    out: dict[str, int] = {}
    for c in criteria:
        s = c.get("status", "unknown")
        out[s] = out.get(s, 0) + 1
    return out


def select_case_recommended_action(state: dict[str, Any]) -> dict[str, Any] | None:
    """Pick the single highest-priority pending artifact as the case-level action."""
    # Priority order: targeted_question > imperfect_extraction > note_addendum > verification_task
    _prio = ["targeted_question", "imperfect_extraction", "note_addendum", "verification_task"]
    pending: list[tuple[dict, dict]] = []
    for crit in state.get("criteria", []):
        art = crit.get("artifact") or {}
        if art.get("status") in ("pending_approval", "pending_answer"):
            pending.append((crit, art))

    if not pending:
        n_open = sum(
            1 for c in state["criteria"] if c.get("status") in _OPEN | _RECOVERABLE
        )
        if n_open == 0:
            return {
                "type": "GENERATE_PACKET",
                "title": "Ready — generate provenance-linked draft",
                "body": "All criteria have been addressed or actioned. Generate the authorization summary.",
                "criterion_id": None,
                "criterion_label": None,
                "actor": "staff",
                "rationale": "No pending criteria.",
                "artifact_id": None,
                "artifact_type": None,
                "artifact_status": "complete",
            }
        return None

    def _priority(item: tuple) -> int:
        _, art = item
        try:
            return _prio.index(art.get("type", ""))
        except ValueError:
            return 99

    pending.sort(key=_priority)
    crit, art = pending[0]

    _type_map = {
        "targeted_question": "ASK_PATIENT" if art.get("route_to") == "patient" else "ASK_CLINICIAN",
        "note_addendum": "DRAFT_ADDENDUM",
        "imperfect_extraction": "HUMAN_REVIEW",
        "verification_task": "REQUEST_RECORD",
    }

    return {
        "type": _type_map.get(art.get("type", ""), "HUMAN_REVIEW"),
        "title": art.get("title", ""),
        "body": art.get("body", ""),
        "criterion_id": crit["id"],
        "criterion_label": crit.get("label"),
        "actor": art.get("route_to", "clinician"),
        "rationale": f"Criterion '{crit.get('label')}' is {crit.get('status')} and has a pending action.",
        "artifact_id": art.get("id"),
        "artifact_type": art.get("type"),
        "artifact_status": art.get("status"),
    }


def build_packet(state: dict[str, Any]) -> dict[str, Any]:
    facts = []
    for c in state.get("criteria", []):
        if c.get("status") not in (*_ADDRESSED, *_RECOVERABLE):
            continue
        art = c.get("artifact") or {}
        if art.get("status") == "dismissed":
            continue
        for ev in c.get("evidence", []):
            if not ev.get("verified", True):
                continue
            facts.append({
                "criterion_id": c["id"],
                "criterion_label": c.get("label"),
                "status": c.get("status"),
                "quoted_span": ev.get("quoted_span"),
                "source_layer": ev.get("source_layer"),
                "source_location": ev.get("source_location"),
            })

    approved_addenda = [
        c["artifact"]
        for c in state.get("criteria", [])
        if c.get("artifact")
        and c["artifact"].get("type") == "note_addendum"
        and c["artifact"].get("status") == "approved"
    ]
    completeness = compute_completeness(state.get("criteria", []))
    return {
        "title": state.get("packet_draft", {}).get("title", "Draft prior authorization packet"),
        "service_requested": state.get("service_requested"),
        "status": "ready_for_review" if completeness["open"] == 0 else "incomplete_pending_hitl",
        "facts": facts,
        "approved_addenda": approved_addenda,
        "disclaimer": "Prototype packet from synthetic data. Not for payer submission.",
    }


def enrich_state(state: dict[str, Any], layers: dict[str, Any]) -> dict[str, Any]:
    verified = verify_belief_state(copy.deepcopy(state), layers)
    verified["completeness"] = compute_completeness(verified.get("criteria", []))
    verified["case_recommended_action"] = select_case_recommended_action(verified)
    verified["packet"] = build_packet(verified)
    verified["layers_preview"] = {
        "transcript_chars": len(layers.get("transcript", "")),
        "note_chars": len(layers.get("note", "")),
        "transcript_words": len(layers.get("transcript", "").split()),
        "note_words": len(layers.get("note", "").split()),
        "fhir_resource_count": sum(
            len(v) for v in layers.get("fhir", {}).get("related_resources", {}).values()
            if isinstance(v, list)
        ),
        "fhir_condition_labels": layers.get("fhir", {}).get("labels", {}).get("Condition", []),
        "longitudinal_conditions": layers.get("fhir", {})
            .get("longitudinal_summary", {}).get("condition_labels", []),
        "fhir_lbp_gap": "Chronic low back pain" not in str(
            layers.get("fhir", {}).get("labels", {}).get("Condition", [])
        ),
        "metadata": layers.get("metadata"),
    }
    verified["policy"] = {
        "id": load_policy().get("id"),
        "service": load_policy().get("service"),
        "source": load_policy().get("source"),
        "disclaimer": load_policy().get("disclaimer"),
    }
    return verified


def analyze_encounter(
    encounter_id: str,
    *,
    session_id: str = "default",
    use_live_mine: bool = False,
) -> dict[str, Any]:
    layers = load_layers(encounter_id)
    key = fixture_key_for(encounter_id)

    if use_live_mine:
        from mine import live_mine
        raw = live_mine(layers)
    elif key:
        raw = load_fixture(key)
    else:
        policy = load_policy()
        raw = {
            "encounter_id": encounter_id,
            "fixture_key": None,
            "policy_id": policy["id"],
            "service_requested": policy["service"],
            "demo_headline": "Browse mode — no curated fixture. Layers loaded from dataset.",
            "criteria": [
                {
                    "id": c["id"],
                    "label": c["label"],
                    "status": "unknown",
                    "confidence": 0.0,
                    "summary": "No precomputed adjudication for this encounter.",
                    "evidence": [],
                    "artifact": None,
                }
                for c in policy["criteria"]
            ],
            "fhir_gap_callout": {"title": "Browse layers", "detail": "Curated demos: ★ primary LBP, HTN+LBP, Knee OA."},
            "packet_draft": {"title": "Draft packet", "status": "not_started", "facts": []},
            "browse_only": True,
        }

    state = enrich_state(raw, layers)
    state["encounter_id"] = encounter_id
    state["session_id"] = session_id
    state["transcript"] = layers["transcript"]
    state["note"] = layers["note"]
    state["fhir_text"] = layers["fhir"]["text_blob"]
    _SESSIONS[session_id] = state
    return state


def get_session(session_id: str = "default") -> dict[str, Any] | None:
    return _SESSIONS.get(session_id)


def apply_decision(
    *,
    session_id: str,
    criterion_id: str,
    decision: str,
    edit: str | None = None,
    answer: str | None = None,
) -> dict[str, Any]:
    state = _SESSIONS.get(session_id)
    if not state:
        raise KeyError("No active session — call /api/analyze first")

    before = copy.deepcopy(state)
    found = False
    for crit in state["criteria"]:
        if crit["id"] != criterion_id:
            continue
        found = True
        art = crit.get("artifact") or {}

        if decision == "approve":
            if art:
                art["status"] = "approved"
                if edit:
                    art["body"] = edit
                    art["edited"] = True
                crit["artifact"] = art
            if crit.get("status") in ("conversation_enriched", "spoken_only"):
                crit["status"] = "documented"
                crit["summary"] = (
                    (crit.get("summary") or "") + " Clinician approved addendum."
                ).strip()

        elif decision == "dismiss":
            if art:
                art["status"] = "dismissed"
                crit["artifact"] = art
            if art.get("demo_imperfect") or art.get("type") == "imperfect_extraction":
                crit["imperfect_dismissed"] = True

        elif decision == "edit":
            if art and edit:
                art["body"] = edit
                art["status"] = "approved"
                art["edited"] = True
                crit["artifact"] = art
                if crit.get("status") in ("conversation_enriched", "spoken_only"):
                    crit["status"] = "documented"

        elif decision == "answer":
            if not answer:
                raise ValueError("answer required for decision=answer")
            obs = {
                "source_layer": "patient_followup",
                "quoted_span": answer.strip(),
                "source_location": "hitl.patient_answer",
                "supports": "Patient-supplied observation — not yet clinician-verified",
                "verified": True,
                "verification": {"method": "patient_attestation", "passed": True},
            }
            crit.setdefault("evidence", []).append(obs)
            # Patient answer → patient_reported, NOT documented
            crit["status"] = "patient_reported"
            crit["confidence"] = max(float(crit.get("confidence") or 0), 0.65)
            crit["summary"] = (
                (crit.get("summary") or "")
                + f" Patient-reported: {answer.strip()[:80]}"
            ).strip()
            if art and art.get("type") in ("targeted_question",):
                art["status"] = "answered"
                art["answer"] = answer.strip()
                crit["artifact"] = art
        else:
            raise ValueError(f"Unknown decision: {decision}")
        break

    if not found:
        raise KeyError(f"Unknown criterion_id: {criterion_id}")

    state["completeness"] = compute_completeness(state["criteria"])
    state["case_recommended_action"] = select_case_recommended_action(state)
    state["packet"] = build_packet(state)
    _SESSIONS[session_id] = state

    from log import append_tuple
    append_tuple({
        "session_id": session_id,
        "encounter_id": state.get("encounter_id"),
        "criterion_id": criterion_id,
        "decision": decision,
        "edit": edit,
        "answer": answer,
        "state_before": {
            "criteria": [{"id": c["id"], "status": c["status"]} for c in before["criteria"]],
            "completeness": before.get("completeness"),
            "recommended_action_type": (before.get("case_recommended_action") or {}).get("type"),
        },
        "state_after": {
            "criteria": [{"id": c["id"], "status": c["status"]} for c in state["criteria"]],
            "completeness": state.get("completeness"),
            "recommended_action_type": (state.get("case_recommended_action") or {}).get("type"),
        },
    })
    return state


def default_encounter_id() -> str:
    return PRIMARY_ENCOUNTER_ID
