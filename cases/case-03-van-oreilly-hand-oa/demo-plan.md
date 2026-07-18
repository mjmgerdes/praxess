# Demo Case 03 — Van O'Reilly | Hand Osteoarthritis / Occupational Therapy

## Encounter

**Record ID:** `01573895-dbf5-29c6-4ef9-cd09aecc51f6::01573895-dbf5-29c6-f885-ade2bd6537a5`  
**Dataset:** synthetic-ambient-fhir-25  
**Visit title:** Annual physical — hand osteoarthritis and anxiety screening  
**Date:** 2019-07-25  
**Patient:** Van O'Reilly, Male, DOB 1977-07-14 (age 42 at visit)

## Simulated prior auth request

**Service:** Occupational therapy evaluation  
**CPT:** 97003  
**Policy file:** `payer-policy.json` (5-criterion OT evaluation policy)

## Why this case

Demonstrates that **Praxess generalizes beyond imaging** to therapy authorization,
and shows the most nuanced version of "unknown ≠ no": the prior conservative
treatment criterion is unmet not because the record is incomplete, but because
it genuinely has not happened yet — which is the clinical justification for
the OT referral, not a barrier to it.

The occupational context is vivid and entirely in the transcript: "ten-hour picker
shifts… fingers feel like rusty hinges." The note compresses this considerably.
The physician teaches home exercises at this visit but does not place a formal OT
referral order. Praxess identifies the missing order and the missing prior-treatment
documentation, asks the patient to confirm no prior OT exists, and reframes
the absence as the indication.

## Expected criterion statuses (pre-observation)

| Criterion | Expected status | Evidence |
| :--- | :--- | :--- |
| OT-1 Diagnosis documented | **documented** | Note: "localized primary osteoarthritis of the hand" · FHIR condition: "Localized, primary osteoarthritis of the hand (disorder)" |
| OT-2 Functional / occupational impairment | **conversation-enriched** | Note: "occupational aggravation with a benign exam" · Transcript: "ten-hour picker shifts at a distribution center, gripping totes and scanning — fingers feel like rusty hinges… morning stiffness until the coffee kicks in" |
| OT-3 Prior conservative treatment | **partial** | Note: naproxen PRN (appropriate) + tendon-glide exercises taught *at this visit* (first time documented). No prior formal OT, hand therapy, or supervised rehab anywhere in note, transcript, or FHIR. |
| OT-4 Physician referral and goals | **unknown** | Note documents in-office home exercise instruction but contains no OT referral order. Three-year gap in care; no prior referral traceable. |
| OT-5 Rehabilitation potential | **documented** | Transcript: "grip strong and functional" · Patient engaged, motivated, compliant with current naproxen regimen, agreeable to exercises — no cognitive or physical barrier identified |

## Recommended action (pre-observation)

`ASK_PATIENT`, targeting OT-3:  
*"Have you ever worked with a hand therapist or occupational therapist for your hand pain — at this clinic, another clinic, or on your own? If so, where and roughly when?"*

Rationale: confirms whether prior OT history exists anywhere. If the patient says no
(the scripted response), the absence becomes the documented basis for initiating
formal OT — not a gap to fill, but a clinical fact to record.

## Scripted patient response (entered at demo time)

> "No, nobody's ever sent me to a hand therapist. The doctor before you just told me to take the naproxen. You're the first one who's actually shown me exercises — I didn't even know hand therapy was a thing."

## Expected replan (post-observation)

- OT-3 → **patient-reported** (no prior OT confirmed by patient) — the absence is now documented
- Recommended action changes to `DRAFT_ADDENDUM`: recommend clinician note addendum establishing that conservative home measures have been initiated at this visit and formal OT evaluation is the appropriate next step given occupational impact
- OT-4 remains unknown — the referral order still needs to be placed; Praxess flags this as a required action before submission

## Praxess beats demonstrated

1. **Non-LBP service type** — shows the framework is not hard-coded to one condition or CPT
2. **Absence as documentation** — confirming no prior OT exists is itself a clinical finding
3. **Unknown ≠ No (reversed)** — the missing prior treatment is the indication, not the blocker
4. **Conversation-enriched occupational context** — transcript captures job demands the note does not; relevant to functional necessity argument
5. **Pending referral order detection** — Praxess identifies the missing physician order as a separate required action
