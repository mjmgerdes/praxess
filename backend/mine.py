"""Optional live Claude evidence mining with structured outputs."""

from __future__ import annotations

import json
import os
from typing import Any

from loader import load_policy
from verify import verify_belief_state


def live_mine_available() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def live_mine(layers: dict[str, Any]) -> dict[str, Any]:
    """Mine criteria evidence with Claude; unverifiable spans are stripped by verify."""
    if not live_mine_available():
        raise RuntimeError("ANTHROPIC_API_KEY not set")

    try:
        import anthropic
    except ImportError as e:
        raise RuntimeError("anthropic package not installed") from e

    policy = load_policy()
    prompt = f"""You are adjudicating prior-auth medical-necessity criteria against three source layers.
For EACH criterion, search transcript, note, and FHIR text. Return JSON only.

Statuses (iron rules):
- documented: clear support in note and/or FHIR the payer would see
- spoken_only: support in transcript but NOT adequately in note/FHIR (lossy documentation)
- patient_reported_unverified: patient asserted something needing verification
- unknown: no evidence in any layer — NEVER invent evidence; NEVER treat unknown as no

Every evidence item MUST include quoted_span copied VERBATIM from the claimed source_layer.
If you cannot quote a real span, omit the evidence item.

Policy:
{json.dumps(policy, indent=2)}

TRANSCRIPT:
{layers['transcript'][:12000]}

NOTE:
{layers['note'][:8000]}

FHIR:
{layers['fhir']['text_blob'][:4000]}

Return JSON shape:
{{
  "encounter_id": "{layers['id']}",
  "fixture_key": null,
  "policy_id": "{policy['id']}",
  "service_requested": "{policy['service']}",
  "demo_headline": "string",
  "criteria": [
    {{
      "id": "criterion id",
      "label": "label",
      "status": "documented|spoken_only|patient_reported_unverified|unknown",
      "confidence": 0.0,
      "summary": "one sentence",
      "evidence": [
        {{
          "source_layer": "transcript|note|fhir",
          "quoted_span": "verbatim",
          "source_location": "string",
          "supports": "string"
        }}
      ],
      "artifact": null
    }}
  ],
  "fhir_gap_callout": {{"title": "string", "detail": "string"}},
  "packet_draft": {{"title": "Draft prior authorization packet", "status": "incomplete_pending_hitl", "facts": []}}
}}
"""

    client = anthropic.Anthropic()
    msg = client.messages.create(
        model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-20250514"),
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )
    text = next((b.text for b in msg.content if getattr(b, "type", None) == "text"), None)
    if text is None:
        raise RuntimeError(f"Claude returned no text block (stop_reason: {msg.stop_reason})")
    # Extract JSON object
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < 0:
        raise RuntimeError("Claude returned no JSON object")
    raw = json.loads(text[start : end + 1])
    verified = verify_belief_state(raw, layers)
    verified["live_mined"] = True
    return verified
