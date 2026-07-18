"""Optional live Claude evidence mining with structured outputs."""

from __future__ import annotations

import json
import os
from typing import Any

from loader import load_policy
from verify import verify_belief_state

# Current stable Sonnet 4 snapshot — override via ANTHROPIC_MODEL env var.
_DEFAULT_MODEL = "claude-sonnet-4-5-20250929"


def live_mine_available() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


import re as _re


def _parse_labeled_transcript(transcript: str) -> list[dict] | None:
    """If every non-empty line starts with DR: or PT:, parse and return turns.

    Returns None when the transcript is unlabeled raw speech.
    """
    lines = [l.strip() for l in transcript.splitlines() if l.strip()]
    if not lines:
        return None
    parsed = []
    for line in lines:
        m = _re.match(r'^(DR|PT|Doctor|Patient|Provider|Clinician)[:\s]+(.+)', line, _re.IGNORECASE)
        if not m:
            return None  # at least one unlabeled line → need Claude
        spk = "PT" if m.group(1).upper().startswith("P") else "DR"
        parsed.append({"speaker": spk, "text": m.group(2).strip()})
    return parsed


def diarize(transcript: str) -> list[dict]:
    """Use Claude to label speaker turns in a raw transcript.

    Returns a list of {speaker: 'DR'|'PT', text: str} dicts.
    If the transcript already carries DR:/PT: prefixes the labels are parsed
    directly without an API call.  Falls back gracefully when Claude is
    unavailable.
    """
    # Fast path: transcript already has speaker labels (e.g. from the Abridge
    # fixture or from a previous diarize pass that was formatted and re-sent).
    pre_labeled = _parse_labeled_transcript(transcript)
    if pre_labeled is not None:
        return pre_labeled

    if not live_mine_available():
        # No API key and no labels — return as a single unlabeled DR block so
        # the UI at least shows the text rather than nothing.
        return [{"speaker": "DR", "text": transcript.strip()}]

    try:
        import anthropic
    except ImportError:
        return [{"speaker": "DR", "text": transcript.strip()}]

    prompt = f"""You are a medical transcription assistant. Label each turn in the following clinical conversation as either DR (doctor/clinician) or PT (patient).

Rules:
- Return ONLY a JSON array, no other text.
- Each element: {{"speaker": "DR" or "PT", "text": "the spoken text"}}
- Preserve the original wording exactly.
- Merge consecutive lines from the same speaker into one entry.
- Infer the speaker from context: clinical questions/assessments = DR, symptoms/history/responses = PT.

Transcript:
{transcript}

JSON array:"""

    client = anthropic.Anthropic()
    msg = client.messages.create(
        model=os.environ.get("ANTHROPIC_MODEL", _DEFAULT_MODEL),
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )
    text = next((b.text for b in msg.content if getattr(b, "type", None) == "text"), None)
    if text is None:
        return [{"speaker": "DR", "text": transcript.strip()}]
    text = text.strip()
    start = text.find("[")
    end = text.rfind("]")
    if start < 0 or end < 0:
        return [{"speaker": "DR", "text": transcript.strip()}]
    result = json.loads(text[start : end + 1])
    # Normalise speaker labels
    for item in result:
        spk = str(item.get("speaker", "DR")).upper()
        item["speaker"] = "PT" if spk.startswith("P") else "DR"
    return result


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
        model=os.environ.get("ANTHROPIC_MODEL", _DEFAULT_MODEL),
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
