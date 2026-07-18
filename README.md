# Praxess

**Prior auth from the room** — a conversation-grounded world model for prior authorization. Praxess mines the clinical conversation for the medical-necessity evidence the note lost, verifies every claim against its source before it can enter case state, rolls out candidate next actions with an explicit value function, and drives the case to approval with a clinician approving every consequential step — including after a denial.

> Prototype built during the Abridge × Anthropic × Lightspeed HealthTech Hackathon (July 18, 2026). Synthetic organizer-provided data only. Criteria hand-structured from public policy language. Not for payer submission. Not HIPAA-validated. Not a trained world model — it fits priors from the event corpus and logs the trajectory flywheel that could train one.

## Demo one-liner

*The evidence for this denial was spoken in the visit. The note just lost it. We found it, priced the next best action, drafted the fix, and the doctor approved it in one click — and when the payer says no, the same loop plans the appeal.*

## Quick start

```bash
./scripts/dev.sh          # venv + npm install + API on :8000 + UI on :5173
```

or manually:

```bash
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
.venv/bin/uvicorn app:app --reload --port 8000 --app-dir backend
cd frontend && npm install && npm run dev   # separate terminal
```

Open http://localhost:5173 — the root URL is the **7-screen closed-loop UI**:

**encounter → world model → decision engine → addendum → patient question → packet → submission / appeal**

The `ENGINE LIVE` chip means real `/api/analyze` + `/api/decide` round-trips against the FastAPI engine (falls back to a self-contained walkthrough if the API is down). Demo script: [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) · curated case plans: [cases/](cases/).

Live Claude features (optional): copy `.env.example` → `.env`, set `ANTHROPIC_API_KEY`, restart the API. Enables live evidence mining, automatic doctor/patient speaker labeling for recorded encounters, and transcript analysis.

**Deployment:** single-service build (Dockerfile + `railway.toml`) — the FastAPI app serves the built frontend; `VITE_API_URL` points the UI at the backend in production.

## What the loop does

- **Encounter** — browse every dated visit in the chart and read its transcript/note, or record a new one: one red button, live in-browser transcription, doctor/patient turns labeled automatically by Claude as you speak.
- **World model** — five layers of case state (transcript, note, FHIR, patient, payer policy), every fact bound to its source; priors fit from the full 25-encounter corpus (60% of encounters carry conservative-care evidence in the conversation that the note lost).
- **Decision engine** — candidate actions scored with an explicit value equation, `EV(a|s) = 1.00·ΔP(approve) + 0.35·infoGain − 0.25·delay/30d − 0.15·burden`, state-conditioned rollouts, argmax recommended; premature submission prices at a projected denial.
- **Addendum / patient question** — the transcript may inform the record but never modify it: drafted artifacts stay behind a clinician approve/edit/dismiss gate; the patient answers one targeted question and the answer stays **patient-reported** until a record verifies it.
- **Replan** — new observations visibly change the recommended action (ask the patient → request the record from the named facility). That flip is the world model working.
- **Packet** — provenance-linked evidence summary; every assertion cites transcript, note, FHIR, patient response, or external record; downloadable as a submission-grade PDF (request grid, criteria dispositions with verbatim cited evidence, attestation).
- **Submission / appeal** — a payer response is just another observation. A denial re-plans into an EV-ranked appeal workspace: appeal letter drafted from case state + peer-to-peer call prep, behind the same clinician gate. The case is not done until care is approved.
- **Flywheel** — every human-approved decision logs a state/action/outcome tuple (`tuples.jsonl`); refit scripts fold them back into the action estimates. Labeled honestly: fitted priors, not a trained model.

## Dataset

Uses [`synthetic-ambient-fhir-25/`](synthetic-ambient-fhir-25/) (Abridge hackathon package): 25 synthetic encounters with transcript, note, AVS, and FHIR R4 context.

| Curated demo | Why |
|---|---|
| 2021-04-06 chronic low back pain | `spoken_only` gap: ibuprofen trial duration in transcript only; note lossy; encounter FHIR missing the LBP condition |
| 2025-07-13 HTN + LBP | Control: mostly `documented` — the agent does not invent gaps |
| 2016-08-30 knee OA | Alternate conservative-therapy pattern under the same policy engine |

Three fully-worked case plans (expected statuses, scripted responses, replans) live in [cases/](cases/).

## Architecture

```
JSONL record + policy JSON                    live recording (Web Speech)
        ↓                                              ↓
Evidence mining (fixture-first; optional Claude)   Claude diarization (DR/PT)
        ↓                                              ↓
Deterministic span verification gate  ←────────  transcript analysis
        ↓
Provenance belief state (documented | spoken_only | patient_reported_unverified | unknown)
        ↓
Value-function rollouts → recommended action
        ↓
Artifacts (addendum / targeted question / appeal letter / P2P prep)
        ↓
HITL approve / edit / dismiss / answer  →  replan
        ↓
Draft PA packet (+ PDF) · submission · post-denial appeal loop
        ↓
tuples.jsonl flywheel log → prior refit scripts
```

**Iron rules:** `unknown` never becomes `no`. Unverifiable spans are rejected before they can enter state. Patient-reported stays labeled patient-reported until record-verified. Nothing commits without clinician approval.

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Engine status + live-mine availability |
| GET | `/api/encounters` | Dataset index + policy |
| GET | `/api/encounter?encounter_id=` | One visit's transcript/note/metadata (no analysis) |
| POST | `/api/analyze` | Load fixture (or live mine) → belief state |
| POST | `/api/analyze_transcript` | Analyze a freshly recorded/pasted transcript |
| POST | `/api/diarize` | Label DR/PT speaker turns in raw transcript (Claude) |
| POST | `/api/decide` | HITL approve / dismiss / edit / answer + replan |
| GET | `/api/session` | Current belief state + pending artifacts |
| GET | `/api/trajectories` | Ranked trajectory rollouts for the current state |

## Honest claims

Say: prototype · synthetic data · hand-structured criteria · corpus-fit priors · logged trajectories for a future learned model.

Never claim: HIPAA compliance · payer connectivity · clinical validation · autonomous submission · a trained world model.

## Team

Maya Gerdes & Abhay Lal — built during the event; the demo highlights only day-of work.
