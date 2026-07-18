# Praxess — Demo Cases

Three prior-authorization demo cases sourced from the
[synthetic-ambient-fhir-25](../synthetic-ambient-fhir-25/) dataset provided by Abridge.
Each case demonstrates a distinct dimension of the Praxess evidence loop.

All data is fully synthetic. No real patient data is present.

---

## Case index

| Folder | Patient | Service | CPT | Key Praxess beat |
| :--- | :--- | :--- | :--- | :--- |
| [case-01-julius-renner-lbp](./case-01-julius-renner-lbp/) | Julius Renner, 35M | Lumbar MRI | 72148 | Unknown ≠ No → patient question → retrieve external record |
| [case-02-eva-casas-knee-oa](./case-02-eva-casas-knee-oa/) | Eva Casas, 62F | Knee MRI | 73721 | Transcript > note → clinician addendum |
| [case-03-van-oreilly-hand-oa](./case-03-van-oreilly-hand-oa/) | Van O'Reilly, 42M | OT evaluation | 97003 | Absence as documentation → non-imaging service type |

---

## What each folder contains

```
cases/
└── case-NN-name/
    ├── encounter.json    ← Full record extracted from synthetic-ambient-fhir-25.jsonl
    │                       (transcript, note, FHIR, patient context)
    ├── payer-policy.json ← Synthetic prior-auth criteria for the simulated service
    └── demo-plan.md      ← Expected criterion statuses, scripted responses, replan
```

---

## Case 01 — Julius Renner | Lumbar MRI (72148)

**Record ID:** `6d4fd363-1ddb-74f8-516f-2fdc861cb736::6d4fd363-1ddb-74f8-95dd-b53404f1e107`

Chronic low back pain × 6 years. The conservative therapy criterion (LBP-2) is
**partial** — the note says "previously taught stretches" with no provider, facility,
or dates. The transcript never resolves it. Praxess fires a targeted patient question;
the patient names Metro Physical Therapy (Jan–Mar 2025). Status shifts from partial
→ patient-reported; recommended action shifts from ASK_PATIENT → REQUEST_RECORD.

Reuses `data/payer-policy.json` verbatim (5-criterion LBP lumbar-MRI policy).

---

## Case 02 — Eva Casas | Knee MRI (73721)

**Record ID:** `73043f9e-3254-a1d3-aa45-b82f0fc6d502::73043f9e-3254-a1d3-ecbd-a0c16f2d8db0`

Knee osteoarthritis with a winter-predominant flare pattern. The visit happens in
summer — the patient is asymptomatic today (0/10). The note documents this faithfully
and therefore undersells the case. The transcript contains four to five years of
recurrent flare history and seasonal functional limitation that never made it into
the note. Praxess flags functional impairment (KNEE-4) as **partial** (not documented),
surfaces the transcript evidence, and recommends a clinician addendum — without
inventing anything.

---

## Case 03 — Van O'Reilly | Occupational Therapy Evaluation (97003)

**Record ID:** `01573895-dbf5-29c6-4ef9-cd09aecc51f6::01573895-dbf5-29c6-f885-ade2bd6537a5`

Hand osteoarthritis in a distribution center picker (ten-hour gripping shifts).
The physician teaches home exercises at this visit for the first time but places no
formal OT referral order. No prior hand therapy exists anywhere. Praxess confirms
the absence via a targeted patient question, then reframes it: the lack of prior OT
is the indication, not the gap. Demonstrates that Praxess generalizes beyond
imaging to therapy authorization and handles non-LBP condition types.

---

## Relationship to the active demo build

The active demo (see `SOURCE_OF_TRUTH.md` §DAY-OF) runs on the Emory Kovacek
encounter (`data/encounter.json`, record `1ba8eeb9…`). These three cases are
**candidate expansions** — ready-to-wire with their own `encounter.json` and
`payer-policy.json` — demonstrating that the same loop works across different
conditions, services, and evidence gap types.
