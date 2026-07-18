"""Trajectory rollout engine — deterministic proxy for the stochastic world-action model.

Each trajectory represents a simulated future under one candidate action.
Q(s, a) = R(s, a, s') + γV(s')
Implemented here as a weighted heuristic until real outcome data trains the model.
"""

from __future__ import annotations
from typing import Any

# Weight vector for the Q-score heuristic.
# These are stand-in priors. When real outcome data accrues (tuples.jsonl),
# this vector can be learned via offline regression.
_W = {
    "approval": 10.0,      # P(appropriate care)
    "uncertainty": 7.0,    # uncertainty reduction per action
    "days": -0.45,         # –E(days to care)
    "clinical_risk": -6.0, # –E(clinical harm)
    "staff_burden": -2.0,  # –E(staff burden)
}

# Action permission matrix (from spec)
_PERMISSION = {
    "SUBMIT_NOW": "human_approval",
    "ASK_PATIENT": "autonomous",
    "ASK_CLINICIAN": "autonomous",
    "REQUEST_RECORD": "autonomous",
    "DRAFT_ADDENDUM": "human_approval",
    "PEER_TO_PEER": "human_approval",
    "ESCALATE": "autonomous",
}


def _q(r: dict) -> float:
    return (
        r["approval_likelihood"] * _W["approval"]
        + r["uncertainty_reduction"] * _W["uncertainty"]
        + r["days_to_care"] * _W["days"]
        + r["clinical_risk"] * _W["clinical_risk"]
        + r["staff_burden"] * _W["staff_burden"]
    )


# ── Phase detection ────────────────────────────────────────────────────────────

def _phase(criteria: list[dict]) -> str:
    """Infer where we are in the demo loop."""
    status_map = {c["id"]: c.get("status", "unknown") for c in criteria}

    # PT answered by patient → patient_reported
    if status_map.get("conservative_care") == "patient_reported":
        # Check if all other open items are resolved
        still_open = [
            c for c in criteria
            if c.get("status") in ("unknown", "partial")
            and c["id"] != "conservative_care"
        ]
        if not still_open:
            return "ready_to_submit"
        return "patient_answered"

    # Any artifact answered
    any_answered = any(
        c.get("artifact", {}) and c["artifact"].get("status") == "answered"
        for c in criteria
    )
    if any_answered:
        return "patient_answered"

    open_count = sum(1 for c in criteria if c.get("status") in ("unknown", "partial"))
    if open_count > 0:
        return "initial"

    all_addressed = all(
        c.get("status") in ("documented", "conversation_enriched", "patient_reported")
        for c in criteria
    )
    if all_addressed:
        return "ready_to_submit"

    return "heuristic"


# ── Demo trajectory templates ──────────────────────────────────────────────────

def _rollouts_initial() -> list[dict]:
    return [
        {
            "id": "ask_patient_conservative",
            "action_type": "ASK_PATIENT",
            "label": "Ask patient: PT facility and dates",
            "actor": "patient",
            "days_to_care": 5.0,
            "approval_likelihood": 0.81,
            "clinical_risk": 0.05,
            "staff_burden": 0.15,
            "uncertainty_reduction": 0.70,
            "predicted_outcome": (
                "Patient identifies PT facility (e.g., Metro PT) and dates. Conservative care "
                "criterion resolves to patient-reported. Next action becomes: retrieve records to "
                "verify. Expected authorization timeline: 5–7 days."
            ),
            "why": (
                "Conservative care is the only unresolved criterion blocking submission. "
                "Patient is the fastest resolution path and requires no staff record-retrieval work. "
                "Unlocks the record-retrieval trajectory."
            ),
            "counterfactual": (
                "Without this, submission approval likelihood is ~42% and triggers "
                "a likely denial → 14–21 day appeals cycle."
            ),
        },
        {
            "id": "submit_now",
            "action_type": "SUBMIT_NOW",
            "label": "Submit authorization now",
            "actor": "staff",
            "days_to_care": 18.0,
            "approval_likelihood": 0.42,
            "clinical_risk": 0.20,
            "staff_burden": 0.30,
            "uncertainty_reduction": 0.05,
            "predicted_outcome": (
                "Authorization submitted with incomplete conservative therapy documentation. "
                "High payer denial probability citing unverified PT duration. "
                "Likely outcome: denial → 14–21 day appeals cycle."
            ),
            "why": (
                "Not recommended: unresolved conservative care criterion is a documented "
                "denial trigger under this policy. Submitting before resolving it wastes "
                "~2 weeks of the patient's time."
            ),
            "counterfactual": (
                "Payers using InterQual/MCG criteria flag missing PT duration as "
                "an automatic soft denial trigger."
            ),
        },
        {
            "id": "request_records_direct",
            "action_type": "REQUEST_RECORD",
            "label": "Request outside PT records directly",
            "actor": "staff",
            "days_to_care": 12.0,
            "approval_likelihood": 0.74,
            "clinical_risk": 0.08,
            "staff_burden": 0.55,
            "uncertainty_reduction": 0.55,
            "predicted_outcome": (
                "ROI submitted to PT provider (unknown). Records may arrive in 7–10 days. "
                "Delays submission but produces clinician-verifiable documentation."
            ),
            "why": (
                "More staff-intensive than asking patient first. "
                "Patient can identify the provider faster at zero staff cost."
            ),
            "counterfactual": "Falls back to this path if patient cannot identify the provider.",
        },
        {
            "id": "draft_addendum",
            "action_type": "DRAFT_ADDENDUM",
            "label": "Draft clinician note addendum",
            "actor": "clinician",
            "days_to_care": 4.5,
            "approval_likelihood": 0.65,
            "clinical_risk": 0.05,
            "staff_burden": 0.40,
            "uncertainty_reduction": 0.40,
            "predicted_outcome": (
                "Clinician adds a brief addendum acknowledging PT attempt. Moderately "
                "strengthens case but may not specify required duration detail payer needs."
            ),
            "why": (
                "Weaker than record retrieval — addendum without supporting records may not "
                "satisfy payer criteria. Better as a supplement after records confirm dates."
            ),
            "counterfactual": "Useful in parallel with record retrieval to reinforce clinical reasoning.",
        },
    ]


def _rollouts_patient_answered() -> list[dict]:
    return [
        {
            "id": "retrieve_pt_records",
            "action_type": "REQUEST_RECORD",
            "label": "Request PT records from identified facility",
            "actor": "staff",
            "days_to_care": 4.5,
            "approval_likelihood": 0.91,
            "clinical_risk": 0.04,
            "staff_burden": 0.30,
            "uncertainty_reduction": 0.85,
            "predicted_outcome": (
                "PT records confirm duration and dates. Conservative care criterion "
                "upgrades from patient-reported to documented. Authorization packet "
                "reaches submission-ready status. Expected approval: 91%."
            ),
            "why": (
                "Patient identified the provider. Record retrieval converts patient-reported "
                "to clinician-verified. This is now the highest-value remaining action."
            ),
            "counterfactual": (
                "Without records, conservative care stays patient-reported — "
                "payer may still request verification before approving."
            ),
        },
        {
            "id": "submit_with_patient_report",
            "action_type": "SUBMIT_NOW",
            "label": "Submit now with patient-reported PT",
            "actor": "staff",
            "days_to_care": 8.0,
            "approval_likelihood": 0.65,
            "clinical_risk": 0.15,
            "staff_burden": 0.25,
            "uncertainty_reduction": 0.10,
            "predicted_outcome": (
                "Authorization submitted with patient-reported conservative care. "
                "Some payers accept attestation; others require records. "
                "Moderate 35% denial risk remains."
            ),
            "why": (
                "Faster than waiting for records but leaves residual payer risk. "
                "Reasonable if time pressure is high and payer is known to accept attestation."
            ),
            "counterfactual": (
                "If payer rejects attestation, restarts at records request "
                "— net cost: ~3–5 additional days."
            ),
        },
        {
            "id": "dual_track",
            "action_type": "DRAFT_ADDENDUM",
            "label": "Draft addendum + request records (parallel)",
            "actor": "clinician",
            "days_to_care": 5.0,
            "approval_likelihood": 0.88,
            "clinical_risk": 0.04,
            "staff_burden": 0.50,
            "uncertainty_reduction": 0.78,
            "predicted_outcome": (
                "Clinician acknowledges patient-reported PT in addendum while records are "
                "retrieved in parallel. Dual-track approach. Slightly higher staff burden "
                "but resilient if records are delayed."
            ),
            "why": (
                "Good fallback if records take longer than expected — addendum provides "
                "interim documentation for time-sensitive submissions."
            ),
            "counterfactual": "If records arrive quickly, addendum becomes redundant — small overhead.",
        },
    ]


def _rollouts_ready() -> list[dict]:
    return [
        {
            "id": "generate_packet",
            "action_type": "SUBMIT_NOW",
            "label": "Generate and submit authorization packet",
            "actor": "staff",
            "days_to_care": 2.0,
            "approval_likelihood": 0.93,
            "clinical_risk": 0.03,
            "staff_burden": 0.20,
            "uncertainty_reduction": 0.95,
            "predicted_outcome": (
                "All five criteria documented with verified sources. "
                "Authorization packet is submission-ready. "
                "Expected approval within 1–2 business days."
            ),
            "why": "All criteria resolved. This is the terminal action for this case pathway.",
            "counterfactual": "Delaying adds no information value — case is fully documented.",
        },
    ]


def _rollouts_heuristic(state: dict[str, Any]) -> list[dict]:
    """Fallback heuristic for non-demo encounters."""
    criteria = state.get("criteria", [])
    open_c = [c for c in criteria if c.get("status") in ("unknown", "partial", "conversation_enriched")]
    n = len(open_c)

    if not open_c:
        return _rollouts_ready()

    first = open_c[0]
    rollouts = [
        {
            "id": "resolve_top",
            "action_type": "ASK_PATIENT",
            "label": f"Resolve: {first['label']}",
            "actor": "patient",
            "days_to_care": 4.0 + n,
            "approval_likelihood": min(0.90, 0.58 + (5 - n) * 0.08),
            "clinical_risk": 0.06,
            "staff_burden": 0.20,
            "uncertainty_reduction": 0.60,
            "predicted_outcome": (
                f"Addressing '{first['label']}' has the highest marginal information value. "
                f"{n - 1} criterion/criteria would remain after."
            ),
            "why": "Highest-uncertainty criterion targeted first (max uncertainty-reduction heuristic).",
            "counterfactual": f"Remaining {n - 1} criteria likely resolved in subsequent steps.",
        },
        {
            "id": "submit_now",
            "action_type": "SUBMIT_NOW",
            "label": "Submit authorization now",
            "actor": "staff",
            "days_to_care": 15.0 + n * 2,
            "approval_likelihood": max(0.25, 0.68 - n * 0.12),
            "clinical_risk": 0.18,
            "staff_burden": 0.30,
            "uncertainty_reduction": 0.05,
            "predicted_outcome": (
                f"{n} criterion/criteria unresolved. Submission carries elevated denial risk."
            ),
            "why": f"{n} open criteria represent documented denial triggers. Premature submission likely.",
            "counterfactual": "Resolving open criteria first is the lower-risk path.",
        },
    ]
    return rollouts


# ── Public API ─────────────────────────────────────────────────────────────────

def get_trajectories(state: dict[str, Any]) -> list[dict]:
    """Compute ranked trajectory rollouts from current case state.

    Returns a list of rollout dicts, sorted by Q-score descending.
    The top entry is `recommended: True`; others are alternatives.

    This is a deterministic heuristic proxy for a stochastic world-action model.
    As outcome data accumulates in logs/tuples.jsonl the weight vector can be
    learned from real (state, action, outcome) triples.
    """
    criteria = state.get("criteria", [])
    phase = _phase(criteria)

    if phase == "initial":
        rollouts = _rollouts_initial()
    elif phase == "patient_answered":
        rollouts = _rollouts_patient_answered()
    elif phase == "ready_to_submit":
        rollouts = _rollouts_ready()
    else:
        rollouts = _rollouts_heuristic(state)

    # Compute Q-scores and rank
    for r in rollouts:
        r["q_score"] = round(_q(r), 2)
        r["permission"] = _PERMISSION.get(r["action_type"], "human_approval")

    rollouts.sort(key=lambda r: r["q_score"], reverse=True)

    for i, r in enumerate(rollouts):
        r["rank"] = i + 1
        r["recommended"] = i == 0

    return {
        "phase": phase,
        "trajectories": rollouts,
        "model_note": (
            "Heuristic prior — weights not yet learned from outcome data. "
            f"Q(s,a) = {_W['approval']}·P(approval) + {_W['uncertainty']}·ΔU "
            f"- {abs(_W['days'])}·days - {abs(_W['clinical_risk'])}·risk - {abs(_W['staff_burden'])}·burden"
        ),
        "outcome_count": 0,  # increments as tuples.jsonl grows
    }
