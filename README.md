# Praxess

**Prior auth from the room** — a closed-loop prior authorization agent that mines the clinical conversation for medical-necessity evidence, verifies every claim deterministically, drives the case to approval with a clinician approving every consequential step, and keeps running after a denial.

> Built during the **Abridge × Anthropic × Lightspeed HealthTech Hackathon** (July 18, 2026).
> Synthetic organizer-provided data only.

---

## The problem in one sentence

The evidence for most PA denials was **spoken in the visit** — the note just lost it.

A physician says: *"You mentioned ibuprofen for a while — did that help?"*
The patient answers: *"Yeah, worked great, but the bottle ran out months ago."*
The note records: *"Ibuprofen prescribed."*
The payer sees: no documented trial duration → denial.

Praxess listens to that conversation, finds what the note missed, prices the next best action, drafts the fix behind a clinician approval gate, and — when the payer still says no — plans the appeal from the same evidence.

---

## Demo one-liner

*The evidence for this denial was spoken in the visit. The note lost it. We found it, priced the next best action, drafted the fix, and the doctor approved it in one click — and when the payer says no, the same loop plans the appeal.*

---

## Quick start

```bash
./scripts/dev.sh          # venv + npm install + API on :8000 + UI on :5173
```

Or manually:

```bash
# Backend
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
cp .env.example .env      # add your ANTHROPIC_API_KEY for live features
.venv/bin/uvicorn app:app --reload --port 8000 --app-dir backend

# Frontend (separate terminal)
cd frontend && npm install && npm run dev
```

Open **http://localhost:5173** — the 7-screen closed-loop UI starts immediately with a pre-loaded synthetic encounter.

The `ENGINE LIVE` chip in the header means real API round-trips are running. Falls back to a self-contained walkthrough if the backend is unreachable.

**Optional live Claude features:** set `ANTHROPIC_API_KEY` in `.env` and restart. Enables automatic speaker diarization when recording a new encounter, and live evidence mining against the actual transcript + note + FHIR (see [Anthropic section](#anthropic-claude-two-specific-uses) below).

---

## The 7-screen loop

```
01 · Encounter     →  02 · World model  →  03 · Decision engine
→  04 · Addendum   →  05 · Patient Q    →  06 · PA packet
→  07 · Submission / appeal  →  (loops back on new observation)
```

| Screen | What happens |
|--------|-------------|
| **01 Encounter** | Browse every dated visit, read its transcript/note, or tap 🎙 to record a new one. Live in-browser transcription via Web Speech API; Claude labels DR vs PT turns as you speak. |
| **02 World model** | Five evidence layers — transcript, note, FHIR, patient channel, payer policy — displayed as a 3-D constellation. Every fact is a node bound to its source. |
| **03 Decision engine** | Candidate next actions ranked by an explicit value equation. The recommended action is the argmax; premature submission prices in the projected denial. |
| **04 Addendum** | Claude-drafted paragraph surfacing spoken evidence not in the note. Clinician can **edit** the text inline, **approve**, or **dismiss** — nothing enters the record without that gate. |
| **05 Patient question** | One targeted question dispatched via SMS / voice / secure link (Twilio). Patient answer stays labeled `patient_reported` until a record verifies it. |
| **06 PA packet** | Provenance-linked prior authorization summary. Every assertion cites transcript, note, FHIR, patient response, or external record. Downloadable PDF. |
| **07 Submission & appeals** | A payer response (approved / more info / denied) is just another observation. Denial re-plans into an EV-ranked appeal workspace: appeal letter drafted from case state + peer-to-peer call prep — all behind the clinician gate. |

---

## Anthropic / Claude — two specific uses

Claude (`claude-sonnet-4-5-20250929`) is used for exactly two tasks, both in `backend/mine.py`. Everything else is deterministic.

### 1. Speaker diarization — `POST /api/diarize`

When a clinician records a new encounter using the in-browser recorder, the Web Speech API produces a flat stream of text — no punctuation, no speaker labels. Before that text can become evidence, it needs to be split into doctor and patient turns.

**What Claude sees:** raw transcript text, e.g.:
```
how is the back today still pretty sore any pain down the legs
no nothing like that just the low back okay have you tried anything
for the pain yeah ibuprofen helped but i ran out months ago
```

**What Claude returns:** a JSON array of labeled turns:
```json
[
  {"speaker": "DR", "text": "How is the back today?"},
  {"speaker": "PT", "text": "Still pretty sore."},
  {"speaker": "DR", "text": "Any pain down the legs?"},
  {"speaker": "PT", "text": "No, nothing like that. Just the low back."},
  ...
]
```

These labeled turns appear live in the recording panel as the clinician speaks. When the recorder is stopped, the fully-labeled transcript is what gets analyzed for PA evidence.

> **Fast path:** if the transcript already carries `DR:` / `PT:` prefixes (the Abridge fixture, or a previously-diarized recording), Claude is skipped entirely and labels are parsed deterministically — no API call needed.

---

### 2. Live evidence mining — `POST /api/analyze` (with `live_mine=true`) and `POST /api/analyze_transcript`

This is the main reasoning call. Claude reads all three source layers — transcript (up to 12 000 chars), clinical note (up to 8 000 chars), FHIR text blob (up to 4 000 chars) — alongside the loaded payer policy JSON, and adjudicates each of the five medical-necessity criteria.

**What Claude returns for each criterion:**

```json
{
  "id": "nsaid_trial",
  "label": "NSAID trial documented",
  "status": "spoken_only",
  "confidence": 0.72,
  "summary": "Patient states ibuprofen worked but ran out months ago — duration absent from the note.",
  "evidence": [
    {
      "source_layer": "transcript",
      "quoted_span": "ibuprofen for a while, which worked, but the bottle ran out months ago",
      "source_location": "encounter transcript line ~47",
      "supports": "NSAID trial occurred; duration not documented"
    }
  ]
}
```

**The four statuses Claude may assign:**

| Status | Meaning |
|--------|---------|
| `documented` | Clear support in note and/or FHIR that the payer sees |
| `spoken_only` | Support in transcript but not adequately in note/FHIR — the documentation gap |
| `patient_reported_unverified` | Patient asserted something that needs verification from a record |
| `unknown` | No evidence in any layer — **never treated as "no"** |

**The iron rule:** `unknown ≠ no`. Missing documentation does not mean the care did not happen. The agent is explicitly prompted never to invent evidence and never to convert unknown into a denial.

**After Claude responds — the verification gate (`verify.py`):** Every `quoted_span` Claude returns is run through a deterministic substring search against the actual source text. Any span that does not match verbatim is **stripped before it can enter case state**. Claude is never the safety layer; it is only the hypothesis generator. The verifier is the safety layer.

---

## Data capture — world-model flywheel

Every time a clinician takes a consequential action through the HITL gate, Praxess appends a structured tuple to `backend/logs/tuples.jsonl`:

```json
{
  "ts": "2026-07-18T23:14:52Z",
  "session_id": "design",
  "encounter_id": "2021-04-06-chronic-lbp",
  "criterion_id": "conservative_care",
  "decision": "approve",
  "edit": null,
  "answer": null,
  "state_before": {
    "criteria": [{"id": "symptom_duration", "status": "documented"}, ...],
    "completeness": {"pct": 62, "met": 2, "total": 5},
    "recommended_action_type": "addendum"
  },
  "state_after": {
    "criteria": [...],
    "completeness": {"pct": 78, "met": 3, "total": 5},
    "recommended_action_type": "patient_question"
  }
}
```

**Why this matters:** each tuple is a `(state, action, outcome)` triple — the raw material for training a learned world model. The log captures:

- What the case looked like before the action (criteria statuses, completeness score, current recommendation)
- What action the human approved (or edited, or dismissed)
- How the case state changed as a result (new statuses, new recommendation)
- Which criterion was affected and what was said

**The intent:** as this runs across real PA workflows, the logged trajectories form a dataset that can be used to:
1. Refit the action-value priors (currently corpus-estimated heuristics) from observed outcomes
2. Train a supervised model to predict `P(approve | state)` from real determinations
3. Build an imitation learning policy from clinician approval decisions

**Honest label:** this is a *flywheel that can train a world model*, not a trained world model. Today it uses hand-estimated priors fit from the 25-encounter hackathon corpus.

---

## Evidence flow

```
Live recording (Web Speech API)             Abridge encounter (JSONL)
        ↓                                          ↓
Claude diarization (DR/PT turns)          transcript + note + FHIR
        ↓                                          ↓
           ┌──────────────────────────────────────┘
           ↓
  Evidence mining  ──────────  Fixture (pre-computed, default)
  (Claude, optional)           belief_state_primary_lbp.json
           ↓
  Deterministic span verification (verify.py)
  — unverifiable quoted_spans stripped here —
           ↓
  Provenance belief state
  documented | spoken_only | patient_reported_unverified | unknown
           ↓
  Completeness score + value-function rollouts
  EV(a|s) = 1.00·ΔP(approve) + 0.35·infoGain − 0.25·delay/30d − 0.15·burden
           ↓
  Recommended action (argmax)
           ↓
  Artifact generation (addendum / patient question / appeal letter / P2P)
           ↓
  HITL gate — clinician approve / edit / dismiss / answer
           ↓
  State update + replan  →  tuples.jsonl flywheel log
           ↓
  Draft PA packet → submission → post-denial appeal loop
```

---

## Iron rules (non-negotiable)

- **`unknown ≠ no`** — missing documentation never becomes a finding of absence
- **Unverifiable spans are stripped** — Claude's quoted evidence is substring-verified before entering state; hallucinated quotes are rejected
- **Patient-reported stays labeled** — a patient's answer to a targeted question stays `patient_reported` until a facility record verifies it
- **Nothing sends without human approval** — addendum, outreach, packet, and appeal all require explicit clinician go-ahead
- **No secrets in this repo** — it is public; API keys via environment variables only

---

## Architecture

```
frontend/          React + Vite · 7-screen loop UI
  src/
    LoopApp.jsx    Main UI — all 7 screens, HITL actions, live recording
    WorkspaceApp.jsx  Case list → LoopApp routing
    api.js         apiFetch() wrapper → /api/*

backend/
  app.py           FastAPI — all API routes
  state.py         In-memory belief state, HITL apply_decision(), flywheel log
  mine.py          Claude calls: diarize() + live_mine()
  verify.py        Deterministic span verification gate
  trajectories.py  Value-function rollouts, EV ranking
  loader.py        Encounter / policy / FHIR data loading
  log.py           Append-only tuples.jsonl flywheel logger
  actions.py       Pending artifact extractor
  fixtures/        Pre-computed belief states (fixture-first demo)
  logs/            tuples.jsonl (world-model training data)

cases/             Three fully-worked curated case plans
synthetic-ambient-fhir-25/   Abridge hackathon dataset (25 encounters)
```

---

## API reference

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Engine status + live-mine availability |
| GET | `/api/encounters` | Dataset index + policy |
| GET | `/api/encounter?encounter_id=` | One visit's transcript / note / metadata |
| POST | `/api/analyze` | Load fixture or live-mine → belief state |
| POST | `/api/analyze_transcript` | Analyze a freshly recorded or pasted transcript |
| POST | `/api/diarize` | Label DR/PT turns in raw speech (Claude) |
| POST | `/api/decide` | HITL approve / edit / dismiss / answer + replan |
| GET | `/api/session` | Current belief state + pending artifacts |
| GET | `/api/trajectories` | EV-ranked trajectory rollouts for current state |

---

## Dataset

Uses [`synthetic-ambient-fhir-25/`](synthetic-ambient-fhir-25/) — 25 synthetic encounters from the Abridge hackathon package. Each includes transcript, clinical note, AVS, and FHIR R4 context.

| Curated demo case | Why it was chosen |
|---|---|
| 2021-04-06 · chronic low back pain | Primary demo: `spoken_only` gap — ibuprofen trial duration is in the transcript, absent from the note; encounter FHIR missing the LBP condition |
| 2025-07-13 · HTN + LBP | Control case: mostly `documented` — the agent does not invent gaps that aren't there |
| 2016-08-30 · knee OA | Alternate conservative-therapy pattern under the same policy engine |

---

## Team

**Maya Gerdes & Abhay Lal** — built during the Abridge × Anthropic × Lightspeed HealthTech Hackathon, July 18 2026. Demo highlights day-of work only.
