# Praxess

**Prior auth from the room** — an evidence-provenance agent that mines the clinical conversation for medical-necessity proof the note lost, verifies every claim against its source, and drafts the prior-auth packet with a clinician approving every change.

> Prototype for a hackathon. Synthetic organizer-provided data. Criteria hand-structured from public policy language. Not for payer submission. Not HIPAA-validated. Not a trained world model — it logs the flywheel that could train one.

## Demo one-liner

*The evidence for this denial was spoken in the visit. The note just lost it. We found it, drafted the fix, and the doctor approved it in one click.*

## Quick start

```bash
# Backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
cd backend && uvicorn app:app --reload --port 8000

# Frontend (separate terminal)
cd frontend && npm install && npm run dev
```

Open http://localhost:5173 — curated encounters are marked ★. Default is the **2021 chronic low back pain** visit.

**Demo loop UI:** http://localhost:5173/praxess-ui.html — the 7-screen closed-loop walkthrough
(encounter → world model → decision engine → addendum → patient question → packet → submission/appeal),
wired to the live engine (`ENGINE LIVE` chip = real `/api/analyze` + `/api/decide` round-trips; falls back
to a self-contained walkthrough if the API is down). Demo script: [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

Optional live re-mine: copy `.env.example` → `.env`, set `ANTHROPIC_API_KEY`, restart the API, click **Re-mine**.

## Dataset

Uses [`synthetic-ambient-fhir-25/`](synthetic-ambient-fhir-25/) (Abridge hackathon package): 25 synthetic encounters with transcript, note, AVS, and FHIR R4 context.

| Curated demo | Why |
|---|---|
| 2021-04-06 chronic low back pain | `spoken_only` gap: ibuprofen trial duration / hot showers in transcript; note lossy; encounter FHIR missing LBP condition |
| 2025-07-13 HTN + LBP | Control: mostly `documented` — agent does not invent gaps |
| 2016-08-30 knee OA | Alternate conservative-therapy pattern under the same policy engine |

## Architecture

```
JSONL record + lumbar_mri.json
        ↓
Evidence mining (fixture-first; optional Claude)
        ↓
Deterministic span verification gate
        ↓
Provenance belief state (documented | spoken_only | patient_reported_unverified | unknown)
        ↓
Artifacts (addendum / targeted question) → HITL approve/edit/dismiss/answer
        ↓
Draft PA packet + tuples.jsonl flywheel log
```

**Iron rules:** `unknown` never becomes `no`. Unverifiable spans are rejected. Nothing commits without clinician approval.

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/encounters` | Dataset index + policy |
| POST | `/api/analyze` | Load fixture (or live mine) → belief state |
| POST | `/api/decide` | HITL approve / dismiss / edit / answer + replan |

## Honest claims

Say: prototype · synthetic data · hand-structured criteria · logged trajectories for a future learned model.

Never claim: HIPAA compliance · payer connectivity · clinical validation · autonomous submission · a trained world model.
