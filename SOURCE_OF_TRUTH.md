# **Praxess: Four-Hour Hackathon Source of Truth**

> **This file is canonical.** If the plan changes, change this file in the same commit. Both teammates (and both teammates' Claude Code sessions) work from this document — see `CLAUDE.md`.

---

## **DAY-OF UPDATE (Jul 18, ~2:30 PM) — locked build. Where this block conflicts with sections below, this block wins.**

* **Demo case (supersedes §4):** `primary_lbp` — **Emory Kovacek, 22M**, 2021-04-06 chronic-LBP visit (encounter `1ba8eeb9…2e7d-8c427e72b964`), lumbar MRI CPT 72148. One case carries **both** beats: **C4** self-directed conservative care → resolved by the clinician-approved **addendum** (gap = ibuprofen-trial *duration + cessation reason*, verbatim in the transcript: "for a while, which worked, but the bottle ran out months ago"); **C5** physical therapy → *never discussed in the visit* (genuinely unknown) → **targeted patient question** → "~8 wks at Metro Physical Therapy, Jan–Mar" (patient-reported, not auto-satisfying) → replan to **request the PT record**. The record-12 case (`data/encounter.json` etc.) stays in the repo as supporting data but is not the demo.
* **Stack (supersedes §12 "preferred"):** the shipped stack is the §12 *alternative* — **Vite/React frontend + Python/FastAPI backend** (`backend/app.py`; routes `/api/encounters`, `/api/analyze`, `/api/decide`, `/api/session`). Fixture-first analysis with optional live Claude mining; deterministic span verification; belief state + completeness; HITL approve/edit/dismiss/answer; `tuples.jsonl` flywheel log.
* **Interface (supersedes §10 layout):** the Claude-Design **7-screen loop UI**, ported natively into the React app per `design_handoff_praxess/README.md` — `frontend/src/LoopApp.jsx` is the root view at `/` (encounter → world model → decision engine → addendum → patient question → packet → submission/appeal); `?classic=1` keeps the engine console; `frontend/public/praxess-ui.html` retained as the design reference. Wired live: statuses hydrate from `/api/analyze` on load; Approve round-trips `/api/decide` into the session (ENGINE LIVE chip); self-contained fallback if the API is down. All transcript copy is **verbatim** from the dataset.
* **Scope amendment (amends §5):** submission tracking + payer response + appeal prep are IN as **simulated lifecycle transitions** in screen 07 (labeled "Simulate" in the UI) — per the final-loop design: *a payer response is just a new observation; appeals are the same loop.* Still out: real payer submission, live recording, EHR integration, and everything else §5 lists.
* **Demo assets:** script + video shot list + submission checklist in `docs/DEMO_SCRIPT.md`. Honest-claims line for judges is in README ("Is the UI real or a mockup?" answer in the script).
* **Branch `feat/outreach-and-polish` (merge later):** (1) screen 05 gains an **automated-outreach beat with a human-in-the-loop go-ahead** — channel choice (Twilio SMS · Twilio+ElevenLabs voice · secure link), nothing dispatches without clinician approval, labeled "demo · simulated gateway"; (2) **case-state constellation** on the World Model screen (`CaseConstellation.jsx`, pseudo-3D technique ported from praxigen's landing centerpiece, sources orbit the persistent case state); (3) motion/interaction polish per the design skills (fast exponential-ease transitions, tactile buttons, focus rings, cinematic shell entrance, `prefers-reduced-motion` respected); (4) **world-model must-haves** — explicit value function `EV(a|s) = wA·ΔP(approve) + wI·infoGain − wT·delay/30d − wB·burden` drives every rollout (equation + per-term breakdown shown on the decision screen), priors **fit from all 25 Abridge encounters** (`scripts/train_world_model.py`; honesty: fitted priors, not a trained model — corpus stat: 60% of encounters carry conservative-care evidence in the conversation the note lost), **flywheel refit** folds `tuples.jsonl` trajectories back into the action estimates (`scripts/refit_from_flywheel.py`, weekly cron); (5) **payer intelligence** synced from the Praxigen coverage API (`data/payer-intel.json` + nightly `scripts/refresh_payer_intel.py`, schedule in `ops/CRON.md`) — UHC/Aetna route 72148 via eviCore per ACR AC 2021, traditional Medicare needs no PA — cited live inside the appeal letter; (6) **post-denial loop** (praxigen mechanisms): denial → appeal workspace with EV-ranked options → grounded appeal letter (verbatim spans + payer-intel citation, clinician-approved) + peer-to-peer call prep → appeal filed → re-determination; path-to-approval stays <100% until care is approved.

---

# **0. Event logistics and rules**

**Event:** Abridge x Anthropic x Lightspeed HealthTech Hackathon — [Cerebral Valley page](https://cerebralvalley.ai/e/abridge-hackathon)
**Location:** Shack15, Ferry Building, Suite 201, San Francisco (doors 9:00 AM, bring ID)
**Discord:** https://discord.gg/KDc96Fr6uR

**Timeline (day-of):**

| Time | What |
| :---- | :---- |
| 10:30 AM | Hacking begins |
| **5:00 PM** | **Submissions due** ([submit here](https://cerebralvalley.ai/e/abridge-hackathon/hackathon/submit)) — feature freeze 4:15 PM |
| 5:00–6:45 PM | Round 1 judging (~3 min live demo + Q&A) |
| 7:00–8:00 PM | Final round (top 6, on stage) |

**Rules that constrain us:**

* Repo must be **public** ✓ (this one: `mjmgerdes/praxess`)
* Max 2 team members; both must be on the submission
* **New work only** — the demo may only highlight what was built during the event; judges must be able to identify what was created day-of
* Submission requires a **1-minute demo video**
* No secrets, no data we lack rights to; only organizer-provided synthetic data

**Judging criteria (Round 1 weighting):** Execution 30% · Creativity/Originality 25% · Impact 20% · Technical Complexity 20%. *A focused, finished build beats an ambitious broken one.*

**Abridge dataset:** anonymized encounters + notes + transcripts + FHIR — [download zip](https://drive.google.com/file/d/14TA58TvEotA_oqbnfKdV9ZzpKHUfSZKn/view?usp=sharing)

---

## **1. Product**

# **Praxess**

### **A conversation-grounded action model for prior authorization**

**Tagline:** Recover what the record lost. Resolve what is still unknown.

**Simple description:**

Praxess analyzes the clinical conversation, note, FHIR record, and payer criteria to reconstruct the current prior-authorization case. It identifies what is documented, partially supported, patient-reported, or unknown, then recommends and executes the smallest human-approved action needed to make the case review-ready.

**Simple analogy:** Google Maps for healthcare access.

It understands the current case, identifies possible next steps, recommends the best route, and reroutes when new information arrives.

---

# **2. The problem**

Prior authorization requests are frequently delayed because the payer-visible documentation does not contain all the information needed to establish medical necessity.

The relevant evidence may be fragmented across:

* the visit conversation,  
* the final clinical note,  
* structured FHIR data,  
* the patient,  
* external treatment records,  
* and the clinician’s memory.

A missing fact in the note does not mean the underlying event did not happen.

For example:

The note does not establish how long the patient attempted conservative treatment.

Possible explanations include:

* the treatment never occurred,  
* the patient mentioned it but the note compressed the detail,  
* the treatment occurred at an outside facility,  
* the patient knows the dates but the clinic does not,  
* or the supporting record has not been retrieved.

Each explanation requires a different next action.

Existing policy checkers typically say:

“This criterion is unsupported.”

Praxess instead asks:

“What is actually known, what remains uncertain, who can resolve it, and what should happen next?”

---

# **3. Why the clinical conversation matters**

The clinical note is a compressed representation of the encounter.

The transcript may contain:

* exact treatment history,  
* medication response,  
* symptom progression,  
* functional limitations,  
* outside-provider information,  
* and patient language that adds context to the note.

The note and FHIR record may contain other facts that are more structured or clinician-verified.

No single source represents the full case.

Praxess combines:

Visit transcript  
Clinical note  
FHIR record  
Payer criteria  
Patient follow-up  
Clinician follow-up

into one persistent evidence state.

The core rule is:

Unknown never becomes no.

Missing documentation is not the same as missing history.

---

# **4. Hackathon scope**

We are building one complete prior-authorization preparation loop for one orthopedic case.

## **Chosen case** *(selected day-of — see `data/demo-plan.md` for full detail)*

* Abridge dataset record 12: "General exam — hypertension treatment initiation and chronic low back pain" (Julius Renner, 36M, synthetic) → `data/encounter.json`
* Simulated lumbar MRI (CPT 72148) access scenario
* One hand-structured synthetic payer policy → `data/payer-policy.json` (5 criteria: duration, conservative-therapy trial, pharmacologic management, red-flag/neuro screen, functional impairment)
* The unresolved criterion is the conservative-therapy trial ("previously taught stretches" — by whom? when?); expected statuses, scripted patient response, and expected replan are in `data/demo-plan.md`

The Abridge dataset provides anonymized encounters, clinical notes, transcripts, and related FHIR information for use in hackathon projects.

## **What the prototype proves**

Praxess can:

1. Load an encounter.  
2. Compare payer criteria against the transcript, note, and FHIR record.  
3. Preserve the exact source of every claim.  
4. Distinguish complete, partial, patient-reported, and unknown evidence.  
5. Recommend one targeted next action.  
6. Allow human approval.  
7. Accept a new patient or clinician observation.  
8. Update the evidence state.  
9. Change the recommended next action.  
10. Generate a provenance-linked draft authorization summary.

---

# **5. What we are not building**

Do not build:

* a general payer-policy parser,  
* multiple patients,  
* multiple fully functioning cases,  
* real payer submission,  
* real EHR integration,  
* authentication,  
* accounts,  
* a database,  
* a vector database,  
* LangChain,  
* LangGraph,  
* a live transcription system,  
* a learned world model,  
* Q-values,  
* UCB,  
* fake approval probabilities,  
* complex trajectory simulation,  
* a full graph database,  
* a payer-facing portal,  
* appeals,  
* step therapy,  
* post-operative monitoring,  
* voice calling,  
* faxing,  
* or full Praxigen integration.

The focused MVP specification similarly limits the build to one encounter, one structured policy, evidence mining, verification, human-reviewed actions, a state update, and a provenance-linked output.

---

# **6. Core user**

## **Primary user**

A prior-authorization specialist or clinical operations employee at an orthopedic practice.

## **Secondary user**

A clinician reviewing a drafted clarification or note addendum.

## **Patient role**

The patient can answer one targeted question or identify where an external treatment record exists.

The patient does not:

* interpret payer policy,  
* decide whether they qualify,  
* or provide automatically verified clinical evidence.

---

# **7. Evidence statuses**

Each payer criterion receives one user-facing status.

## **Documented**

The note or structured record clearly supports the criterion.

## **Conversation-enriched**

The note contains the general fact, while the transcript provides useful additional context.

## **Partial**

Some evidence exists, but a required detail remains unresolved.

Example:

* treatment attempted,  
* but duration is unknown.

## **Patient-reported**

The patient supplied information, but it requires clinician or record verification before submission.

## **Unknown**

No available source resolves the criterion.

## **Contradicted**

Available sources disagree and require human review.

The application may support `spoken_only` internally, but we should not force the demo encounter to produce it if the note already contains the same general evidence.

---

# **8. Persistent case state**

Use one in-memory `CaseState`.

```ts
type EvidenceSource =  
  | "clinical_note"  
  | "transcript"  
  | "fhir"  
  | "patient_followup"  
  | "clinician_followup"  
  | "external_record";

type VerificationStatus =  
  | "record_verified"  
  | "clinician_verified"  
  | "patient_reported"  
  | "unverified"  
  | "contradicted"  
  | "unknown";

type CoverageReadiness =  
  | "submission_ready"  
  | "partial"  
  | "needs_verification"  
  | "unresolved"  
  | "human_review_required";

type EvidenceFact = {  
  id: string;  
  criterionId: string;  
  concept: string;  
  value: string;  
  sourceType: EvidenceSource;  
  exactQuote?: string;  
  sourceLocation?: string;  
  verificationStatus: VerificationStatus;  
  coverageReadiness: CoverageReadiness;  
};

type CriterionState = {  
  id: string;  
  label: string;  
  description: string;  
  status:  
    | "documented"  
    | "conversation_enriched"  
    | "partial"  
    | "patient_reported"  
    | "unknown"  
    | "contradicted";  
  evidence: EvidenceFact[];  
  missingInformation?: string[];  
  recommendedAction?: RecommendedAction;  
};

type RecommendedAction = {  
  id: string;  
  type:  
    | "NO_ACTION"  
    | "ASK_PATIENT"  
    | "ASK_CLINICIAN"  
    | "REQUEST_RECORD"  
    | "DRAFT_ADDENDUM"  
    | "GENERATE_PACKET"  
    | "ESCALATE";  
  description: string;  
  actor: "system" | "patient" | "clinician" | "staff";  
  rationale: string;  
  expectedStateChange: string;  
  requiresHumanApproval: boolean;  
};

type CaseState = {  
  caseId: string;  
  requestedService: string;  
  criteria: CriterionState[];  
  recommendedAction: RecommendedAction;  
  history: StateTransition[];  
};
```

Keep separate:

* observed facts,  
* predicted state changes,  
* and actual new observations.

Claude cannot silently convert a prediction into a fact.

---

# **9. Core agent workflow**

## **Step 1: Load the encounter**

Load:

* transcript,  
* clinical note,  
* relevant FHIR data,  
* structured payer criteria.

Only pass relevant normalized FHIR facts to Claude.

## **Step 2: Analyze evidence**

For each payer criterion, Claude returns:

* criterion ID,  
* status,  
* supporting facts,  
* exact quotes,  
* source locations,  
* unresolved details,  
* recommended action.

Every Claude response must pass schema validation.

## **Step 3: Verify provenance**

For every quoted claim:

1. Perform a deterministic string search against the claimed source.  
2. If the exact text exists, accept it.  
3. For minor formatting differences, optionally use Claude to adjudicate.  
4. If the source cannot be verified, reject the claim.

No unverifiable fact enters the case state.

## **Step 4: Recommend one action**

Map the current evidence state to a constrained action.

Documented  
→ No evidence action required

Partial treatment history  
→ Ask one targeted question

Patient identifies outside provider  
→ Request corresponding record

Conversation contains useful omitted context  
→ Draft clinician-reviewed addendum

Clinical fact requires examination or judgment  
→ Ask clinician

Sources conflict  
→ Escalate to human review

## **Step 5: Human approval**

The user can:

* Approve  
* Edit  
* Dismiss

Nothing is submitted or made final automatically.

## **Step 6: Apply a new observation**

A patient or clinician supplies one answer.

Example:

“I completed eight weeks of physical therapy at Metro Physical Therapy between January and March.”

Store it as:

Source: patient follow-up  
Verification: patient-reported  
Facility: Metro Physical Therapy  
Dates: January–March  
Records: not yet verified

## **Step 7: Replan**

Before the patient response:

Ask patient where and when PT occurred.

After the patient response:

Request PT records from Metro Physical Therapy.

The recommendation must visibly change.

## **Step 8: Generate the final artifact**

Generate a draft prior-authorization evidence summary containing:

* requested service,  
* criteria checklist,  
* supported evidence,  
* exact provenance,  
* unresolved facts,  
* patient-reported information clearly labeled,  
* clinician-approved additions,  
* recommended next step.

---

# **10. Minimal interface**

Build one main case page.

Do not build a complex case-management dashboard.

## **Page layout**

```
┌─────────────────────────────────────────────────────────────┐  
│ PRAXESS · Lumbar MRI · Current state: Needs evidence        │  
├───────────────┬────────────────────────┬────────────────────┤  
│ CASE STAGE    │ EVIDENCE STATE         │ NEXT ACTION        │  
│               │                        │                    │  
│ ✓ Encounter   │ Criterion checklist    │ Ask patient for    │  
│ ● PA review   │ Evidence status        │ PT facility/dates  │  
│ ○ Clarify     │ Source provenance      │                    │  
│ ○ Verify      │ Missing details        │ Why this action    │  
│ ○ Packet      │                        │ [Approve]          │  
├───────────────┴────────────────────────┴────────────────────┤  
│ SOURCE EVIDENCE                                             │  
│ Transcript | Note | FHIR | Patient response                 │  
└─────────────────────────────────────────────────────────────┘
```

## **Required visual behavior**

When a new observation is entered:

1. Show it entering the evidence state.  
2. Update the criterion status.  
3. Change the recommended next action.  
4. Update the packet-readiness indicator.

That state change is the visual explanation of the world-action model.

## **Optional cases page**

Only build a tiny cases page if it takes less than 15 minutes.

It should contain one functional case.

---

# **11. World-model visualization**

Do not build a complicated graph.

Use a simple visual flow:

```
OBSERVATIONS

Transcript   Note   FHIR   Patient  
      \        |      |       /  
       \       |      |      /  
        CURRENT EVIDENCE STATE  
                  |  
        POSSIBLE NEXT ACTIONS  
           /      |       \  
     Submit   Ask patient   Ask clinician  
                  |  
          RECOMMENDED ACTION  
                  |  
            NEW OBSERVATION  
                  |  
             UPDATED STATE
```

For each action, show only:

* actor,  
* why it is available,  
* likely state change,  
* why it is or is not recommended.

Do not show fake probability scores.

---

# **12. Technical architecture**

Use whichever single stack the technical teammate can ship fastest.

## **Preferred stack**

* Next.js  
* TypeScript  
* Tailwind  
* Anthropic TypeScript SDK  
* Zod  
* in-memory state  
* Vercel

Do not add FastAPI if using Next.js Route Handlers.

## **Alternative**

* React/Vite  
* Python/FastAPI  
* Pydantic  
* Anthropic Python SDK  
* in-memory state

Do not use both backend approaches.

## **Core functions**

loadEncounter()

analyzeCriteria()

verifyEvidenceSpans()

constructCaseState()

selectRecommendedAction()

draftArtifact()

approveArtifact()

applyObservation()

replan()

generatePacket()

## **Suggested route flow**

POST /analyze  
POST /artifact  
POST /approve  
POST /observe  
POST /packet

---

# **13. Claude responsibilities**

Claude may:

* interpret transcript language,  
* map evidence to criteria,  
* identify partial or missing information,  
* draft one targeted question,  
* draft a note addendum,  
* explain the recommended action,  
* draft the authorization summary.

Claude may not:

* determine whether its own quotation exists,  
* insert unverified facts into state,  
* act as the database,  
* override human approval,  
* convert patient-reported information into clinical fact,  
* make treatment decisions,  
* or submit anything externally.

---

# **14. Deterministic code responsibilities**

Code must:

* load the source documents,  
* validate Claude output,  
* verify quoted spans,  
* preserve provenance,  
* enforce status transitions,  
* distinguish observations from predictions,  
* retain state history,  
* apply human decisions,  
* prevent unsupported facts,  
* and render the updated case.

---

# **15. Safety**

Praxess must never:

* fabricate evidence,  
* interpret unknown as false,  
* mislabel patient information as clinician-verified,  
* autonomously alter a signed note,  
* autonomously make a treatment decision,  
* claim that approval is guaranteed,  
* or submit to a payer.

If evidence cannot be verified:

Reject it.

If evidence conflicts:

Escalate for human review.

If the system cannot identify a safe action:

Abstain and explain the uncertainty.

---

# **16. Privacy**

For the hackathon:

* use only the organizer’s synthetic data,  
* do not use real Praxigen records,  
* do not commit secrets,  
* do not log raw private information.

A lightweight local de-identification indicator is optional after the full loop works.

Do not claim HIPAA compliance.

The repository must contain no API keys, raw real-patient data, or local re-identification map.

---

# **17. Four-hour implementation plan**

## **Hour 1: Data and state**

Technical teammate:

* create repository,  
* set up application,  
* load selected Abridge encounter,  
* normalize transcript, note, and FHIR,  
* create structured policy JSON,  
* implement schemas.

Maya:

* define approximately five payer criteria,  
* define expected evidence statuses,  
* identify which transcript, note, and FHIR facts should appear,  
* write the simulated patient response.

**Checkpoint:** Encounter and policy load into a valid case state.

## **Hour 2: Analysis and verification**

Technical teammate:

* implement Claude evidence analysis,  
* validate responses,  
* implement deterministic quote verification,  
* return criterion states.

Maya:

* manually inspect every resulting claim,  
* correct policy logic,  
* test whether statuses are clinically and operationally sensible.

**Checkpoint:** CLI or raw page shows a correct criteria checklist with verified sources.

## **Hour 3: Interface and action loop**

Technical teammate:

* build one-page case interface,  
* add source evidence drawer,  
* show recommended action,  
* implement Approve / Edit / Dismiss,  
* implement patient answer input,  
* update state and replan.

Maya:

* write concise action rationales,  
* prepare the demo patient answer,  
* validate the changed recommendation.

**Checkpoint:** Full analyze → action → observation → replan loop works.

## **Hour 4: Artifact, polish, and submission**

Technical teammate:

* generate final evidence summary,  
* deploy,  
* fix blocking bugs,  
* remove unfinished controls.

Maya:

* write README,  
* record one-minute video,  
* rehearse three-minute live demo,  
* prepare Q&A,  
* confirm repository and demo links work publicly.

**Feature freeze:** At least 45 minutes before submission.

## **The hackathon requires a public repository, new work only, and a one-minute video showing the functionality built during the event.**

# **18. Cut order**

Cut these first if behind:

1. Cases page  
2. De-identification visualization  
3. Addendum editing  
4. Separate patient route  
5. External-record upload  
6. Second possible action visualization  
7. Complex animations  
8. PDF export

Never cut:

1. Encounter loading  
2. Multi-source evidence analysis  
3. Provenance verification  
4. Criteria statuses  
5. One recommended action  
6. Human approval  
7. New observation  
8. State update  
9. Changed recommendation  
10. Final draft summary  
11. Working public demo  
12. Video and submission

---

# **19. Definition of done**

The project is ready to submit when:

* The Abridge encounter loads.  
* The policy criteria load.  
* Transcript, note, and FHIR are analyzed.  
* Every displayed claim has a source.  
* Every displayed quote is verified.  
* Unknown remains unknown.  
* Partial evidence is not overstated.  
* The application recommends one targeted action.  
* The user can approve the action.  
* A patient or clinician response can be entered.  
* The response is labeled by source.  
* The criterion state updates.  
* The recommended next action changes.  
* A provenance-linked draft summary is produced.  
* The app works from a clean browser.  
* The repository is public.  
* The repository contains no secrets.  
* The video link is public.  
* Both teammates are listed on the submission.

---

# **20. Three-minute demo**

## **Opening**

“Prior authorization can be delayed because the payer-visible note does not contain the complete treatment history. But missing documentation is not the same thing as missing care.”

## **Analyze**

“Praxess reconstructs the case across the clinical conversation, note, FHIR record, and payer criteria.”

Show the criteria states.

## **Evidence**

“The transcript and note support that conservative treatment was attempted, but the duration remains unresolved. Praxess does not stretch vague evidence into a conclusion.”

Show the exact source context.

## **Action**

“Rather than submitting an incomplete request, Praxess generates the smallest useful next action: ask the patient where and when physical therapy occurred.”

Approve the action and enter the patient answer.

## **Replan**

“That answer is stored as patient-reported, not automatically verified. But it changes the world: Praxess now knows where the record exists, so the next best action becomes retrieving it.”

Show the changed recommendation.

## **Output**

“Praxess generates a review-ready evidence summary where every assertion links back to its source.”

## **Close**

“A policy checker tells staff what is missing. Praxess determines what is actually known, who can resolve what remains, and reroutes the case as new evidence arrives.”

---

# **21. Judge Q&A**

## **“Is this just RAG?”**

No. We are not retrieving from a large knowledge base. We construct and maintain a persistent evidence state across several representations of the same encounter, verify every claim against its source, execute a human-approved action, and update the recommended action after a new observation.

## **“What if Claude hallucinates?”**

Claude cannot directly add an unsupported claim. Every quotation is checked against the claimed source, every response is schema-validated, and consequential artifacts require human approval.

## **“Why is this a world-action model?”**

The note is only one observation of the underlying case. Praxess maintains what is known, partial, patient-reported, verified, and unknown. It evaluates actions based on how they would change that state, executes one, observes the result, and replans.

## **“Why use the conversation?”**

The conversation contains the evidence at the moment it is created. The final record is a compressed version and may lose criterion-level detail.

## **“Does this approve the MRI?”**

No. It prepares a stronger, provenance-linked case for human review. We do not claim payer connectivity, clinical validation, or guaranteed approval.

## **“Can this scale?”**

The same mechanism can be applied to another specialty or service by replacing the structured criteria and action mappings. The long-term system could learn from actual state, action, and outcome trajectories.

---

# **22. Final pitch**

Praxess is a conversation-grounded action model for prior authorization.

It reconstructs the payer-visible case across the clinical conversation, note, FHIR record, and targeted patient or clinician follow-up. It distinguishes what is documented, partially supported, patient-reported, and unknown; verifies every claim against its source; and recommends the smallest human-approved action needed to move the case forward.

In our demo, the record shows that conservative treatment was attempted but does not establish enough detail for the payer criterion. Praxess asks one targeted patient question, records the answer without overstating it, updates the case, and changes the recommended action from gathering history to retrieving the supporting record.

A normal checker tells staff what is missing. Praxess determines what is actually known, who can resolve what remains, and reroutes the patient’s path as the world changes.

---

# **23. Claude Code instruction**

Build only the following vertical slice:

Load one Abridge encounter  
→ analyze five hardcoded payer criteria across transcript, note, and FHIR  
→ verify every evidence quote  
→ render criteria statuses and source context  
→ recommend one constrained next action  
→ allow human approval  
→ accept one patient response  
→ update persistent case state  
→ change the recommendation  
→ generate a provenance-linked draft authorization summary

Prioritize working functionality over reusable abstractions.

Do not add:

* authentication,  
* databases,  
* vector stores,  
* policy parsing,  
* complex graphs,  
* fake probabilities,  
* multiple cases,  
* or external integrations.

Stop adding features once the complete closed loop works.

