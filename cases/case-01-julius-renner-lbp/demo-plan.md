# Demo Case 01 — Julius Renner | Chronic Low Back Pain

## Encounter

**Record ID:** `6d4fd363-1ddb-74f8-516f-2fdc861cb736::6d4fd363-1ddb-74f8-95dd-b53404f1e107`  
**Dataset:** synthetic-ambient-fhir-25  
**Visit title:** General exam — hypertension treatment initiation and chronic low back pain  
**Date:** 2025-07-13  
**Patient:** Julius Renner, Male, DOB 1989-12-17 (age 35 at visit)

## Simulated prior auth request

**Service:** MRI lumbar spine without contrast  
**CPT:** 72148  
**Policy file:** `payer-policy.json` (same as `data/payer-policy.json` — 5-criterion LBP policy)

## Why this case

Six-year chronic LBP with a genuine evidence gap that only the patient can resolve.
"Previously taught stretches" appears in the note with no provider, facility, or dates.
The transcript never surfaces that detail — it stayed in the patient's head.
This is the product thesis in one case: unknown ≠ no.

## Expected criterion statuses (pre-observation)

| Criterion | Expected status | Evidence |
| :--- | :--- | :--- |
| LBP-1 Symptom duration | **documented** | Note: "present about six years" · Transcript: "Same one, going on six years now" · FHIR: active condition "Chronic low back pain (finding)" |
| LBP-2 Conservative therapy trial | **partial** | Note: "previously taught stretches" — no provider, no facility, no dates, no duration anywhere in note or transcript |
| LBP-3 Pharmacologic management | **partial** | Note: acetaminophen 325 mg scheduled · Transcript: prior prescriptions lapsed after insurance gap — onset reason documented, duration of prior trial is not |
| LBP-4 Red-flag / neuro screen | **documented** | Note: "denies radicular pain, numbness, tingling, weakness, and bowel or bladder dysfunction" · Exam: "lower extremities neurovascularly intact; gait normal" |
| LBP-5 Functional impairment | **conversation-enriched** | Note: aggravated by prolonged sitting and stair carrying · Transcript adds: "some evenings it climbs to a five or six," laundry up three flights of stairs |

## Recommended action (pre-observation)

`ASK_PATIENT`, targeting LBP-2:  
*"Where and when did you do the stretching program or physical therapy that was taught to you, and roughly how long did it last?"*

Rationale: smallest action, only the patient can answer it, resolves the sole blocking criterion.

## Scripted patient response (entered at demo time)

> "I did about eight weeks of physical therapy at Metro Physical Therapy, January through March, back when I was still on my old insurance. That's where they taught me the stretches I still do. I think I have the discharge paperwork somewhere in a drawer."

Internally consistent: layoff was April 2025 → Jan–Mar PT predates it; "taught me the stretches I still do" matches note's "previously taught stretches"; old-insurance detail explains the clinic has no current record on file.

## Expected replan (post-observation)

- LBP-2 → **patient-reported** (facility: Metro Physical Therapy; dates: Jan–Mar 2025; duration: ~8 weeks) — explicitly not verified
- Recommended action changes to `REQUEST_RECORD`: request PT discharge summary from Metro Physical Therapy (patient can also upload his copy)
- Packet readiness improves but stays short of submission-ready until the record verifies the patient report

## Praxess beats demonstrated

1. **Unknown ≠ No** — partial evidence in note is not a denial; the gap is fillable
2. **Targeted patient question** — one question, minimum disruption, maximum resolution
3. **State update + replan** — visible flip from ASK_PATIENT → REQUEST_RECORD after new observation
4. **Patient-reported label** — patient response enters state as patient-reported, not auto-verified
