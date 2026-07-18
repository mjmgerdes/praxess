# Praxess

**A conversation-grounded action model for prior authorization.**
*Recover what the record lost. Resolve what is still unknown.*

Praxess analyzes the clinical conversation, note, FHIR record, and payer criteria to reconstruct the current prior-authorization case. It identifies what is documented, partially supported, patient-reported, or unknown — then recommends and executes the smallest human-approved action needed to make the case review-ready.

Built at the **Abridge x Anthropic x Lightspeed HealthTech Hackathon**.

## Start here

- **[`SOURCE_OF_TRUTH.md`](SOURCE_OF_TRUTH.md)** — canonical plan: product, scope, schema, workflow, hour-by-hour build plan, demo script. Read it in full before touching anything.
- [`CLAUDE.md`](CLAUDE.md) — instructions for Claude Code sessions in this repo.

## Team

- Maya Gerdes ([@mjmgerdes](https://github.com/mjmgerdes))
- *(teammate — add yourself here)*

## Data & privacy

Only organizer-provided synthetic/anonymized data is used. No real patient data, no secrets in this repo (API keys via environment variables only). This is a hackathon prototype — no HIPAA-compliance claims.
