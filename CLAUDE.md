# READ FIRST

**`SOURCE_OF_TRUTH.md` is canonical.** Read it in full before doing anything in this repo. It contains the product definition, hackathon rules, scope (§4–5), state schema (§8), agent workflow (§9), the hour-by-hour plan (§17), cut order (§18), and definition of done (§19).

## Build instruction (from SOURCE_OF_TRUTH.md §23)

Build only the vertical slice: load one Abridge encounter → analyze five hardcoded payer criteria across transcript, note, and FHIR → verify every evidence quote deterministically → render criteria statuses and source context → recommend one constrained next action → allow human approval → accept one patient response → update persistent case state → change the recommendation → generate a provenance-linked draft authorization summary.

Prioritize working functionality over reusable abstractions. Stop adding features once the complete closed loop works.

## Hard rules

- **Do not add:** authentication, databases, vector stores, general policy parsing, complex graphs, fake probabilities/scores, multiple cases, external integrations, LangChain/LangGraph.
- **Unknown never becomes no.** Missing documentation ≠ missing history. Evidence statuses per §7.
- Claude output is always Zod-validated; quoted evidence is verified by deterministic string search against the claimed source before entering state (§9 Step 3). Claude is never the database or the safety layer.
- Patient-reported information stays labeled patient-reported until verified. Nothing is submitted or finalized without human approval.
- **No secrets in this repo** (it is public). API key only via environment variables. Only organizer-provided synthetic data — never real patient data, never Praxigen customer data. Do not claim HIPAA compliance.
- If behind schedule, cut in the §18 order. Never cut the closed loop or the demo.

## Maintenance rule

If the plan changes, update `SOURCE_OF_TRUTH.md` in the same commit. Maya's manual edits to it are authoritative — do targeted edits, never revert her changes.
