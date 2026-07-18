# Demo Case 02 — Eva Casas | Knee Osteoarthritis Imaging

## Encounter

**Record ID:** `73043f9e-3254-a1d3-aa45-b82f0fc6d502::73043f9e-3254-a1d3-ecbd-a0c16f2d8db0`  
**Dataset:** synthetic-ambient-fhir-25  
**Visit title:** Annual general exam — prediabetes, hyperlipidemia, and knee osteoarthritis  
**Date:** 2016-08-30  
**Patient:** Eva Casas, Female, DOB 1954-06-22 (age 62 at visit)

## Simulated prior auth request

**Service:** MRI knee without contrast  
**CPT:** 73721  
**Policy file:** `payer-policy.json` (5-criterion knee-MRI policy)

## Why this case

Demonstrates the **transcript-enriches-note** beat in its clearest form.
The visit happens in summer — the patient is asymptomatic today (pain 0/10).
The note faithfully documents the current presentation and therefore undersells
the case: "asymptomatic today with a winter-predominant flare pattern."
The transcript contains the clinically relevant detail: years of recurrent flares,
a seasonal pattern, and a patient who manages at home without escalating to clinic
because she knows the cycle. A policy checker reading only the note would flag
functional impairment as unsupported. Praxess surfaces the transcript evidence
and recommends a clinician addendum — without inventing anything.

## Expected criterion statuses (pre-observation)

| Criterion | Expected status | Evidence |
| :--- | :--- | :--- |
| KNEE-1 Symptom duration | **conversation-enriched** | Note: "winter-predominant flare pattern" (implies years) · Transcript: "It's the winter when it creaks like my kitchen door" — years of recurrent, seasonal pattern; visit happens to fall in summer |
| KNEE-2 Conservative therapy trial | **unknown** | Note documents daily walking as current activity. No formal PT, supervised exercise program, or chiropractic care mentioned anywhere. Transcript is silent on this. |
| KNEE-3 Pharmacologic management | **partial** | Note: naproxen sodium 220 mg as needed · Transcript: "some weeks I take none at all" — PRN use, no scheduled 4-week course, no duration documented |
| KNEE-4 Functional impairment | **partial** | Note: "asymptomatic today" (true — it is summer) · Transcript: "it creaks like my kitchen door," winter-predominant limitation — clinically relevant context that the note does not capture |
| KNEE-5 Red-flag / structural screen | **documented** | Exam: "knees without effusion or warmth; gait normal" — no acute findings, no neurovascular deficit |

## Recommended action (pre-observation)

`DRAFT_ADDENDUM`, targeting KNEE-4:  
Recommend clinician addendum to document flare frequency, seasonal pattern severity,
and impact on mobility during winter episodes — information that is in the transcript
but absent from the note.

Rationale: the clinician already knows this history (they discussed it in the visit).
The addendum is not adding new information — it is surfacing what was said.

## Scripted clinician addendum (entered at demo time)

> "Addendum: Patient reports recurrent bilateral knee pain with a consistent winter-predominant pattern for approximately four to five years. During flare episodes (typically November–February), pain reaches 5–6/10 and limits her ability to walk more than one city block, climb stairs without support, and perform household tasks. She manages with naproxen as needed but limits activity during flares. Current summer presentation is asymptomatic, consistent with her described seasonal pattern."

## Expected replan (post-observation)

- KNEE-4 → **conversation-enriched** (addendum drafted; pending clinician approval)
- KNEE-3 remains partial — scheduled pharmacologic trial still undocumented
- Recommended action changes to `ASK_PATIENT` or `AWAIT_CLINICIAN_APPROVAL` depending on whether the addendum is approved
- KNEE-2 (conservative therapy) becomes the remaining gap for a complete packet

## Praxess beats demonstrated

1. **Conversation-enriched status** — transcript contains material evidence absent from the note
2. **Addendum workflow** — surfacing transcript evidence for clinician review, not auto-inserting it
3. **Asymptomatic-at-visit problem** — common real-world scenario where the note misrepresents the ongoing case
4. **Source provenance** — every claim in the addendum draft is linked back to the transcript quote that supports it
