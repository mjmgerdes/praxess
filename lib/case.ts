import type {
  AnalysisResponse,
  CaseState,
  CriterionState,
  CriterionStatus,
  EvidenceFact,
  ObservationExtraction,
  PayerPolicy,
  SourceDocs,
} from "./types";
import { verifyQuote } from "./verify";
import { selectRecommendedAction } from "./actions";

let factCounter = 0;
function factId(): string {
  factCounter += 1;
  return `fact-${Date.now()}-${factCounter}`;
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Step 3 + state construction: run deterministic verification over every quoted
 * claim, discard what cannot be verified, downgrade statuses that lost all of
 * their support, and assemble the CaseState.
 */
export function constructCaseState(
  analysis: AnalysisResponse,
  policy: PayerPolicy,
  sources: Omit<SourceDocs, "patient_followup">,
  meta: { patientName: string; caseId: string }
): CaseState {
  const rejectedClaims: CaseState["rejectedClaims"] = [];

  const criteria: CriterionState[] = policy.criteria.map((pc) => {
    const a = analysis.criteria.find((c) => c.criterionId === pc.id);
    if (!a) {
      // Claude skipped a criterion entirely — that is unknown, never "no".
      return {
        id: pc.id,
        label: pc.label,
        description: pc.description,
        resolvableBy: pc.resolvableBy,
        status: "unknown" as CriterionStatus,
        statusRationale: "No analysis was returned for this criterion.",
        evidence: [],
        missingInformation: ["Analysis missing — re-run required."],
      };
    }

    const evidence: EvidenceFact[] = [];
    for (const item of a.evidence) {
      const source = sources[item.sourceType];
      const result = verifyQuote(item.exactQuote, source);
      if (!result.verified) {
        rejectedClaims.push({
          criterionId: pc.id,
          quote: item.exactQuote,
          sourceType: item.sourceType,
        });
        continue; // unverifiable claims never enter state (§9 Step 3)
      }
      evidence.push({
        id: factId(),
        criterionId: pc.id,
        concept: item.concept,
        value: item.value,
        sourceType: item.sourceType,
        exactQuote: result.matchedText, // the true source span, for highlighting
        sourceLocation: item.sourceLocation,
        verificationStatus: "record_verified",
        coverageReadiness:
          a.status === "documented" || a.status === "conversation_enriched"
            ? "submission_ready"
            : "partial",
      });
    }

    // A supportive status with zero surviving evidence is unsupported: downgrade.
    let status = a.status;
    if (evidence.length === 0 && (status === "documented" || status === "conversation_enriched" || status === "partial")) {
      status = "unknown";
    }

    return {
      id: pc.id,
      label: pc.label,
      description: pc.description,
      resolvableBy: pc.resolvableBy,
      status,
      statusRationale: a.statusRationale,
      evidence,
      missingInformation: a.missingInformation.length ? a.missingInformation : undefined,
      suggestedPatientQuestion: a.suggestedPatientQuestion,
    };
  });

  const recommendedAction = selectRecommendedAction(criteria);

  return {
    caseId: meta.caseId,
    requestedService: policy.requestedService,
    cptCode: policy.cptCode,
    payer: policy.payer,
    patientName: meta.patientName,
    criteria,
    recommendedAction,
    history: [
      {
        at: now(),
        event: "analyzed",
        detail: `Encounter analyzed against ${policy.criteria.length} payer criteria; ${criteria.flatMap((c) => c.evidence).length} evidence quotes verified, ${rejectedClaims.length} rejected.`,
      },
    ],
    rejectedClaims,
  };
}

/**
 * Steps 6–7: store the patient's answer as patient-reported evidence (never as
 * verified fact), update the criterion, and deterministically replan.
 */
export function applyObservation(
  state: CaseState,
  extraction: ObservationExtraction,
  rawObservationText: string
): CaseState {
  const criteria = state.criteria.map((c) => {
    if (c.id !== extraction.criterionId) return c;

    const newFacts: EvidenceFact[] = [];
    const push = (concept: string, value: string) =>
      newFacts.push({
        id: factId(),
        criterionId: c.id,
        concept,
        value,
        sourceType: "patient_followup",
        exactQuote: rawObservationText,
        verificationStatus: "patient_reported",
        coverageReadiness: "needs_verification",
      });

    if (extraction.facility) push("facility", extraction.facility);
    if (extraction.dates) push("dates", extraction.dates);
    if (extraction.durationWeeks != null) push("duration", `${extraction.durationWeeks} weeks`);
    if (extraction.recordAvailable) push("record availability", extraction.recordAvailable);
    if (newFacts.length === 0) push("patient report", extraction.summary);

    return {
      ...c,
      status: "patient_reported" as CriterionStatus,
      statusRationale: `Patient reported: ${extraction.summary} This information is patient-reported and requires record verification before submission.`,
      evidence: [...c.evidence, ...newFacts],
      missingInformation: ["Supporting record not yet verified" + (extraction.facility ? ` (expected at ${extraction.facility})` : "")],
    };
  });

  const recommendedAction = selectRecommendedAction(criteria);

  return {
    ...state,
    criteria,
    recommendedAction,
    history: [
      ...state.history,
      {
        at: now(),
        event: "observation_applied",
        detail: `Patient response recorded for ${extraction.criterionId} (patient-reported, unverified): ${extraction.summary}`,
      },
      {
        at: now(),
        event: "replanned",
        detail: `Recommended action changed to ${recommendedAction.type}.`,
      },
    ],
  };
}
