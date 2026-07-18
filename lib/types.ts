import { z } from "zod";

// ---- Core state types (SOURCE_OF_TRUTH §8) ----

export type EvidenceSource =
  | "clinical_note"
  | "transcript"
  | "fhir"
  | "patient_followup"
  | "clinician_followup"
  | "external_record";

export type VerificationStatus =
  | "record_verified"
  | "clinician_verified"
  | "patient_reported"
  | "unverified"
  | "contradicted"
  | "unknown";

export type CoverageReadiness =
  | "submission_ready"
  | "partial"
  | "needs_verification"
  | "unresolved"
  | "human_review_required";

export type CriterionStatus =
  | "documented"
  | "conversation_enriched"
  | "partial"
  | "patient_reported"
  | "unknown"
  | "contradicted";

export type EvidenceFact = {
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

export type CriterionState = {
  id: string;
  label: string;
  description: string;
  /** who can resolve this criterion, from the payer policy */
  resolvableBy: string[];
  status: CriterionStatus;
  statusRationale: string;
  evidence: EvidenceFact[];
  missingInformation?: string[];
  suggestedPatientQuestion?: string;
};

export type ActionType =
  | "NO_ACTION"
  | "ASK_PATIENT"
  | "ASK_CLINICIAN"
  | "REQUEST_RECORD"
  | "DRAFT_ADDENDUM"
  | "GENERATE_PACKET"
  | "ESCALATE";

export type RecommendedAction = {
  id: string;
  type: ActionType;
  description: string;
  actor: "system" | "patient" | "clinician" | "staff";
  rationale: string;
  expectedStateChange: string;
  requiresHumanApproval: boolean;
  targetCriterionId?: string;
};

export type StateTransition = {
  at: string; // ISO timestamp
  event: string;
  detail: string;
};

export type CaseState = {
  caseId: string;
  requestedService: string;
  cptCode: string;
  payer: string;
  patientName: string;
  criteria: CriterionState[];
  recommendedAction: RecommendedAction;
  history: StateTransition[];
  /** Quotes Claude claimed that failed deterministic verification (never entered state) */
  rejectedClaims: { criterionId: string; quote: string; sourceType: string }[];
};

// ---- Source documents shipped to the client for the evidence drawer ----

export type SourceDocs = {
  transcript: string;
  clinical_note: string;
  fhir: string; // normalized fact lines, one per line
  patient_followup: string; // grows when an observation is applied
};

// ---- Zod schema for Claude's analysis output (validated before entering state) ----

export const evidenceItemSchema = z.object({
  concept: z.string(),
  value: z.string(),
  sourceType: z.enum(["clinical_note", "transcript", "fhir"]),
  exactQuote: z.string(),
  sourceLocation: z.string().optional(),
});

export const criterionAnalysisSchema = z.object({
  criterionId: z.string(),
  status: z.enum([
    "documented",
    "conversation_enriched",
    "partial",
    "patient_reported",
    "unknown",
    "contradicted",
  ]),
  statusRationale: z.string(),
  evidence: z.array(evidenceItemSchema),
  missingInformation: z.array(z.string()),
  suggestedPatientQuestion: z.string().optional(),
});

export const analysisResponseSchema = z.object({
  criteria: z.array(criterionAnalysisSchema),
});

export type AnalysisResponse = z.infer<typeof analysisResponseSchema>;

// ---- Zod schema for observation extraction ----

export const observationExtractionSchema = z.object({
  criterionId: z.string(),
  facility: z.string().nullable(),
  dates: z.string().nullable(),
  durationWeeks: z.number().nullable(),
  summary: z.string(),
  recordAvailable: z.string().nullable(),
});

export type ObservationExtraction = z.infer<typeof observationExtractionSchema>;

// ---- Policy ----

export type PolicyCriterion = {
  id: string;
  label: string;
  description: string;
  resolvableBy: string[];
};

export type PayerPolicy = {
  payer: string;
  policyId: string;
  policyNote: string;
  requestedService: string;
  cptCode: string;
  indication: string;
  criteria: PolicyCriterion[];
};
