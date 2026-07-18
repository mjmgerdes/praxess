"""Deterministic provenance verification — SOURCE_OF_TRUTH §9 step 3, §14, §15.

Claude may *propose* an evidence span. It may not decide whether its own
quotation exists. This module is the deterministic gate: for every quoted
claim we run a string search against the claimed source. If the exact text
(optionally with whitespace normalized) is present, we accept and stamp the
location. If not, we reject — the fact never enters the case state.

    Unknown never becomes no. Unverifiable never becomes fact.

Load-time sources (clinical_note / transcript / fhir) are searched against the
encounter text. Follow-up sources (patient_followup / clinician_followup /
external_record) are searched against the text actually captured at observation
time, which the caller supplies in `extra_sources`. A patient-reported fact is
"verified" only in the weak sense that the patient really said it — its
VerificationStatus stays `patient_reported`; verification here is about
provenance of the quote, not clinical truth.
"""

from __future__ import annotations

import re
from typing import Dict, Optional, Tuple

from .models import EvidenceFact

_WS = re.compile(r"\s+")


def _normalize(text: str) -> str:
    return _WS.sub(" ", text).strip().lower()


def find_span(quote: str, source_text: str) -> Optional[str]:
    """Return a sourceLocation string if `quote` is present in `source_text`.

    Tries exact substring first (case-insensitive), then a whitespace-normalized
    match to tolerate line wrapping / spacing differences. Returns None if the
    span cannot be located — the caller must then reject the fact.
    """
    if not quote or not source_text:
        return None

    # 1. Exact (case-insensitive) — report the real character offset.
    idx = source_text.lower().find(quote.lower())
    if idx != -1:
        return f"char {idx}-{idx + len(quote)}"

    # 2. Whitespace-normalized — tolerate wrapping/spacing.
    if _normalize(quote) in _normalize(source_text):
        return "whitespace-normalized match"

    return None


def verify_fact(
    fact: EvidenceFact, sources: Dict[str, str]
) -> Tuple[bool, Optional[str]]:
    """Verify one fact's exactQuote against its claimed source.

    A fact with no exactQuote is treated as unverifiable (rejected) unless it is
    an inference-free structural fact — but in this engine every state-entering
    fact must carry a quote, so no-quote => reject.
    """
    source_text = sources.get(fact.source_type)
    if source_text is None:
        # Source not available (e.g. an external_record we never retrieved).
        return False, None
    if not fact.exact_quote:
        return False, None
    location = find_span(fact.exact_quote, source_text)
    if location is None:
        return False, None
    return True, f"{fact.source_type}: {location}"


def verify_and_filter(
    facts: list[EvidenceFact], sources: Dict[str, str]
) -> Tuple[list[EvidenceFact], list[EvidenceFact]]:
    """Split facts into (verified, rejected). Verified facts are stamped in place.

    This is the hard boundary between "Claude said so" and "it's in the record."
    """
    verified: list[EvidenceFact] = []
    rejected: list[EvidenceFact] = []
    for fact in facts:
        ok, location = verify_fact(fact, sources)
        if ok:
            fact.quote_verified = True
            fact.source_location = location
            verified.append(fact)
        else:
            fact.quote_verified = False
            rejected.append(fact)
    return verified, rejected
