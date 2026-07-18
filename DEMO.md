# Demo script (~3 minutes)

**Setup:** backend on `:8000`, frontend on `:5173`. Default encounter already selected (★ 2021-04-06 chronic low back pain).

## 1. Stakes (0:30)

- Click **Run agent**.
- Point at criterion **NSAID / analgesic trial** or **Failed conservative care**.
- Open the **note** evidence: *“previously used ibuprofen… has none at home”* — no duration.
- Line: *“As documented, this MRI gets denied today.”*

## 2. Reveal (1:00)

- Click the `spoken only` row (amber pulse).
- Read the transcript quote: *“Walking. Hot showers. I had ibuprofen for a while… bottle ran out months ago.”*
- Call out the **Encounter FHIR gap** callout (visit conditions omit LBP).
- Line: *“The evidence existed the whole time. The note lost it. We found it.”*

## 3. Human (0:45)

- **Approve** the drafted addendum (completeness jumps).
- On **Red flags**, open the imperfect “prior MRI” artifact → **Dismiss** live.
- On **Functional limitation**, answer the targeted question → **Submit answer & replan**.

## 4. Close (0:45)

- Scroll to **Draft PA packet** (provenance-linked facts).
- Flash **Trajectory log** / `backend/logs/tuples.jsonl`.
- Switch to ★ **2025 HTN + LBP** → Run agent → mostly `documented` (no invented gaps).
- Close: *“Deniable to approvable, zero fabricated facts, a human signed every change.”*

## Honest claims (if asked)

Prototype · synthetic data · hand-structured criteria · flywheel log ≠ trained world model.
