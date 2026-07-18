# Praxess — demo script & video plan

**Setup before judging:** backend running (`uvicorn app:app --port 8000` in `backend/`), frontend running (`npm run dev` in `frontend/`), open `http://localhost:5173/` (the loop UI is the app; `?classic=1` = engine console, `/praxess-ui.html` = original design reference). Confirm the top-right chip says **ENGINE LIVE** (green). Hard-refresh to reset the walkthrough state.

**Case:** Emory Kovacek, 22M (synthetic, Abridge dataset) · chronic low back pain · MRI lumbar spine w/o contrast (CPT 72148).

---

## 3-minute live demo (one line per screen)

**01 · Encounter (~25s)**
> "Prior auth fails when the payer-visible note doesn't carry the evidence. Here's a real encounter from the dataset — every transcript line on screen is verbatim. The note says he used ibuprofen with good effect. What the note *doesn't* say is how long the trial ran or why it stopped. The conversation has it: *'ibuprofen for a while, which worked, but the bottle ran out months ago.'* Missing documentation is not missing care."

Point at the **GAP DETECTED** card + iron rule: *unknown ≠ no*.

**03 · Decision engine (~20s)** — click "Roll out next best action"
> "Praxess doesn't just flag the gap. From the current case state it simulates candidate actions — draft an addendum, ask the patient, submit now — projects the resulting state and payer outcome for each, and selects the highest-value one. Submitting now projects a denial. The addendum wins."

**04 · Addendum (~30s)** — click "Execute · Open addendum"
> "The transcript can inform the record, but it can never modify it. Praxess drafts an addendum using only facts from the conversation, keeps them labeled patient-*reported*, and flags what's still unresolved. The clinician approves."

Click **Approve** → point at the readiness bar moving and C4 turning green.
> "That click just hit the live engine — the criterion flipped to documented in the backend session, not just in the pixels."

**05 · Patient question (~35s)** — back to decision engine → "Execute · Send question"
> "One criterion left: physical therapy — never discussed in the visit, so it's *unknown*, not *no*. The re-planned action is the smallest one that can change the case: one targeted question to the patient. No policy interpretation asked of him."

Click **Simulate patient reply** ("~8 weeks at Metro Physical Therapy, Jan–Mar").
> "His answer is stored as patient-reported. It does **not** auto-satisfy the criterion — but it changes the world: Praxess now knows where the record lives, so the next best action becomes *request the record from Metro PT*. That flip — ask → retrieve — is the world model replanning."

**05b–06 · Record + packet (~25s)** — execute request → simulate record returned → generate packet
> "Record verified, all five criteria supported, and Praxess assembles a review-ready packet where every assertion links to transcript, note, FHIR, patient response, or external record. Draft — the clinician reviews. Praxess does not auto-submit."

**07 · Submission & appeal (~25s)** — submit → click **Denied**
> "The loop keeps running after submission. A payer response is just a new observation. Denied for insufficient conservative-therapy evidence? Praxess re-plans: prepare the appeal with the PT record attached, deadline tracked. Appeals aren't a separate product — they're the same loop."

**Close (~10s)**
> "Most PA tools start after the note is signed. Praxess starts in the room, where the evidence is created — and it never lets *unknown* become *no*."

---

## 1-minute video shot list (screen recording, no webcam)

| # | Shot | Time | On-screen beat |
|---|------|-----|----------------|
| 1 | Encounter screen | 0:00–0:10 | Verbatim transcript + GAP DETECTED card |
| 2 | Decision engine | 0:10–0:18 | Three candidate cards, argmax = addendum, "submit now → denial 82%" |
| 3 | Addendum approve | 0:18–0:28 | Click Approve → readiness 70→80%, C4 green, log entry |
| 4 | Patient phone reply | 0:28–0:40 | Send question → reply "~8 wks Metro PT" → "does NOT auto-satisfy C5" |
| 5 | Replan flip | 0:40–0:48 | Next action becomes "Request records from Metro PT" |
| 6 | Packet | 0:48–0:55 | Provenance-backed packet, all 5 criteria + sources |
| 7 | Deny → appeal | 0:55–1:00 | Denied → re-planned appeal + peer-to-peer, deadline active |

Record at 1280×800+, cursor visible, no audio needed (captions burned in or rely on UI text).

---

## Submission checklist ([submit here](https://cerebralvalley.ai/e/abridge-hackathon/hackathon/submit))

- [ ] Repo public: `mjmgerdes/praxess` ✓ (verify on a logged-out browser)
- [ ] No secrets in repo (`.env` gitignored; grep for `sk-ant`)
- [ ] 1-minute video uploaded, link public (test incognito)
- [ ] Both teammates on the submission
- [ ] Demo works from a clean browser (hard-refresh `praxess-ui.html`, ENGINE LIVE green)
- [ ] Feature freeze 4:15 PM — after that, docs/video only

## Judge Q&A

See `SOURCE_OF_TRUTH.md` §21 for the prepared answers (RAG? hallucination? world-action model? scale?). Extra one for this build:

**"Is the UI real or a mockup?"** — Both layers exist and we're honest about which is which: analysis statuses hydrate from the live FastAPI engine on load and the clinician's Approve round-trips `/api/decide` into the persistent session (the ENGINE LIVE chip is the tell). The record-return and payer-response steps are simulated transitions, labeled "Simulate" in the UI, because we don't claim payer or HIE connectivity. The engine underneath — evidence mining, deterministic span verification, belief state, HITL decisions — is the real product surface; `/docs` on port 8000 shows it.
