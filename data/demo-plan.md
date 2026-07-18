# Demo case plan (Maya's Hour-1 deliverable — SOURCE_OF_TRUTH §17)

## Chosen encounter

`data/encounter.json` — Abridge synthetic dataset, record id
`6d4fd363-1ddb-74f8-516f-2fdc861cb736::6d4fd363-1ddb-74f8-95dd-b53404f1e107`
("General exam — hypertension treatment initiation and chronic low back pain", 2025-07-13).

Patient: Julius Renner, 36M. Chronic low back pain × 6 years, mechanical, no radicular symptoms. Recent care gap (insurance switch after layoff). Simulated scenario: clinician orders a **lumbar MRI (CPT 72148)**; Praxess prepares the prior-auth case against `data/payer-policy.json`.

Why this record: symptom chronicity is over-documented (note + transcript + longitudinal FHIR condition "Chronic low back pain (finding)"), while the conservative-therapy trial is exactly half-documented — "previously taught stretches" (taught by whom?), meds that "ran out months ago" (what? how long?). One criterion is genuinely unresolved, and only the patient can resolve it. That is the whole product thesis in one case.

## Expected criterion statuses (pre-observation)

| Criterion | Expected status | Expected evidence (verifier must find these) |
| :---- | :---- | :---- |
| LBP-1 Symptom duration | **documented** | Note: "present about six years" · Transcript: "Same one, going on six years now" · FHIR chart background: active condition "Chronic low back pain (finding)" |
| LBP-2 Conservative therapy trial | **partial** | Note: "previously taught stretches" · Transcript: "Stretching helps some. Heat helps more." — attempted, but provider/facility, dates, and duration all unresolved |
| LBP-3 Pharmacologic management | **conversation-enriched** | Note: acetaminophen 325 mg scheduled · Transcript enriches: "I ran out of everything months ago and stopped refilling when the insurance switched" — prior self-treatment + lapse reason |
| LBP-4 Red-flag / neuro screen | **documented** | Note: "denies radicular pain, numbness, tingling, weakness, and bowel or bladder dysfunction" · Exam: "lower extremities neurovascularly intact; gait normal" |
| LBP-5 Functional impairment | **conversation-enriched** | Note: aggravated by prolonged sitting and stair carrying · Transcript enriches: "Some evenings it climbs to a five or six", laundry up three flights |

Sanity checks the statuses must survive:
- LBP-2 must NOT come back "documented" — that would be stretching vague evidence (the §15 failure mode).
- Nothing may be marked "unknown" that has a quote above; nothing "documented" without one.
- Unknown never becomes no.

## Recommended action (pre-observation)

`ASK_PATIENT`, targeting LBP-2 only: *"Where and when did you do the taught stretching program or physical therapy, and roughly how long did it last?"* — smallest action, only the patient can answer it, resolves the single blocking criterion.

## Scripted patient response (entered at demo time)

> "I did about eight weeks of physical therapy at Metro Physical Therapy, January through March this year, back when I was still on my old insurance. That's where they taught me the stretches I still do. I think I have the discharge paperwork somewhere in a drawer."

Internally consistent with the record: layoff was in April → Jan–Mar PT predates it; "taught me the stretches I still do" matches the note's "previously taught stretches"; old-insurance detail explains why the clinic has no record.

## Expected replan (post-observation)

- LBP-2 → **patient-reported** (facility: Metro Physical Therapy; dates: Jan–Mar 2025; duration: ~8 weeks) — explicitly *not* verified.
- Recommended action changes to `REQUEST_RECORD`: request the PT discharge summary from Metro Physical Therapy (patient can also upload his copy).
- Packet readiness improves but stays short of submission-ready until the record verifies the patient report.

That visible flip — ask-the-patient → retrieve-the-record — is the demo's money moment (§20).

## Final artifact

Draft PA evidence summary: criteria checklist with statuses, every claim quote-linked to its source, patient-reported items labeled, unresolved item (record verification pending) stated, recommended next step included.
