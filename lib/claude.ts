import Anthropic from "@anthropic-ai/sdk";
import {
  analysisResponseSchema,
  observationExtractionSchema,
  type AnalysisResponse,
  type CaseState,
  type ObservationExtraction,
  type PayerPolicy,
  type SourceDocs,
} from "./types";

const MODEL = "claude-opus-4-8";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env (.env.local)

function firstText(response: Anthropic.Message): string {
  for (const block of response.content) {
    if (block.type === "text") return block.text;
  }
  throw new Error(`Claude returned no text block (stop_reason: ${response.stop_reason})`);
}

// ---- Step 2: analyze evidence for each payer criterion ----

const ANALYSIS_SYSTEM = `You are an evidence-mapping engine for prior-authorization preparation. You compare payer criteria against three source documents from one clinical encounter and report, per criterion, what is actually known.

Hard rules:
- Unknown never becomes no. Missing documentation is not evidence that something did not happen.
- Never overstate: if evidence is vague or a required detail (who/where/when/how long) is unresolved, the status is "partial", not "documented".
- Every evidence item MUST include exactQuote: a verbatim, contiguous substring copied character-for-character from the named source document. Do not paraphrase, do not merge distant sentences, do not fix typos. Quotes are checked mechanically against the source; unverifiable quotes are discarded.
- sourceType must name the document the quote came from: "transcript", "clinical_note", or "fhir" (the FHIR fact lines).
- Statuses: "documented" (note or structured record clearly supports it), "conversation_enriched" (note has the general fact, transcript adds useful context — cite both), "partial" (some evidence but a required detail unresolved), "unknown" (no source resolves it), "contradicted" (sources disagree).
- For each partial/unknown criterion, list the missing details in missingInformation and, if the patient could plausibly resolve them, draft ONE plain-language suggestedPatientQuestion covering all of them.
- statusRationale: one or two sentences a prior-auth specialist would find precise and honest.`;

export async function analyzeCriteria(
  sources: Omit<SourceDocs, "patient_followup">,
  policy: PayerPolicy
): Promise<AnalysisResponse> {
  const userContent = `## Payer policy
Requested service: ${policy.requestedService} (CPT ${policy.cptCode})
Indication: ${policy.indication}

Criteria:
${policy.criteria.map((c) => `- ${c.id} · ${c.label}: ${c.description}`).join("\n")}

## Source document: transcript
<transcript>
${sources.transcript}
</transcript>

## Source document: clinical_note
<clinical_note>
${sources.clinical_note}
</clinical_note>

## Source document: fhir (normalized fact lines — quote whole or partial lines verbatim)
<fhir>
${sources.fhir}
</fhir>

Analyze every criterion and return the JSON.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            criteria: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  criterionId: { type: "string" },
                  status: {
                    type: "string",
                    enum: [
                      "documented",
                      "conversation_enriched",
                      "partial",
                      "patient_reported",
                      "unknown",
                      "contradicted",
                    ],
                  },
                  statusRationale: { type: "string" },
                  evidence: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        concept: { type: "string" },
                        value: { type: "string" },
                        sourceType: {
                          type: "string",
                          enum: ["clinical_note", "transcript", "fhir"],
                        },
                        exactQuote: { type: "string" },
                        sourceLocation: { type: "string" },
                      },
                      required: ["concept", "value", "sourceType", "exactQuote"],
                      additionalProperties: false,
                    },
                  },
                  missingInformation: { type: "array", items: { type: "string" } },
                  suggestedPatientQuestion: { type: "string" },
                },
                required: ["criterionId", "status", "statusRationale", "evidence", "missingInformation"],
                additionalProperties: false,
              },
            },
          },
          required: ["criteria"],
          additionalProperties: false,
        },
      },
    },
    system: ANALYSIS_SYSTEM,
    messages: [{ role: "user", content: userContent }],
  });

  return analysisResponseSchema.parse(JSON.parse(firstText(response)));
}

// ---- Step 6: extract structure from a patient's free-text answer ----

export async function extractObservation(
  observationText: string,
  targetCriterionId: string,
  question: string
): Promise<ObservationExtraction> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            criterionId: { type: "string" },
            facility: { anyOf: [{ type: "string" }, { type: "null" }] },
            dates: { anyOf: [{ type: "string" }, { type: "null" }] },
            durationWeeks: { anyOf: [{ type: "number" }, { type: "null" }] },
            summary: { type: "string" },
            recordAvailable: { anyOf: [{ type: "string" }, { type: "null" }] },
          },
          required: ["criterionId", "facility", "dates", "durationWeeks", "summary", "recordAvailable"],
          additionalProperties: false,
        },
      },
    },
    system: `You extract structure from a patient's answer to one targeted prior-authorization question. Extract only what the patient actually said — never infer or embellish. Set fields to null when the patient did not state them. "recordAvailable" captures anything said about where a supporting record exists or whether the patient has a copy. "summary" is one faithful sentence of what was reported. Set criterionId to the target criterion.`,
    messages: [
      {
        role: "user",
        content: `Target criterion: ${targetCriterionId}\nQuestion asked: ${question}\nPatient's answer: "${observationText}"`,
      },
    ],
  });

  return observationExtractionSchema.parse(JSON.parse(firstText(response)));
}

// ---- Step 8: draft the provenance-linked authorization summary ----

export async function draftPacket(state: CaseState, policy: PayerPolicy): Promise<string> {
  const stateForPrompt = {
    requestedService: state.requestedService,
    cptCode: state.cptCode,
    payer: state.payer,
    patientName: state.patientName,
    criteria: state.criteria.map((c) => ({
      id: c.id,
      label: c.label,
      description: c.description,
      status: c.status,
      statusRationale: c.statusRationale,
      missingInformation: c.missingInformation,
      evidence: c.evidence.map((e) => ({
        concept: e.concept,
        value: e.value,
        source: e.sourceType,
        verification: e.verificationStatus,
        quote: e.exactQuote,
      })),
    })),
    nextStep: state.recommendedAction,
  };

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system: `You draft a prior-authorization evidence summary in Markdown for human review. Use ONLY the facts, quotes, and statuses in the provided case state — every quote in the state has already been verified against its source, and you may not add any claim that is not in the state.

Structure:
1. Header: requested service, CPT, payer, patient, and a one-line readiness statement.
2. Criteria checklist: one section per criterion with its status, a short narrative, and each supporting quote rendered as "> quote" with its source and verification label (e.g. [clinical_note · record], [transcript · record], [patient_followup · PATIENT-REPORTED, not yet verified]).
3. Patient-reported information clearly separated and labeled as requiring verification.
4. Unresolved items: what is still pending and why.
5. Recommended next step.

Never claim approval is likely or guaranteed. Never present patient-reported information as clinician-verified. This is a DRAFT for human review, and must say so at the top.`,
    messages: [
      { role: "user", content: `Case state:\n${JSON.stringify(stateForPrompt, null, 2)}\n\nPolicy note: ${policy.policyNote}` },
    ],
  });

  return firstText(response);
}
