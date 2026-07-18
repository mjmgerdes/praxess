import type { CriterionState, RecommendedAction } from "./types";

/**
 * Deterministic action selection (SOURCE_OF_TRUTH §9 Step 4).
 * Maps the current evidence state to exactly one constrained next action.
 * Claude never chooses the action; it only supplies draft wording
 * (e.g. suggestedPatientQuestion) that this mapping may reference.
 */

let actionCounter = 0;
function actionId(): string {
  actionCounter += 1;
  return `action-${Date.now()}-${actionCounter}`;
}

const RESOLVED = new Set(["documented", "conversation_enriched"]);

function unresolved(c: CriterionState): boolean {
  return c.status === "partial" || c.status === "unknown";
}

export function selectRecommendedAction(criteria: CriterionState[]): RecommendedAction {
  // 1. Conflicting sources always escalate to a human.
  const contradicted = criteria.find((c) => c.status === "contradicted");
  if (contradicted) {
    return {
      id: actionId(),
      type: "ESCALATE",
      description: `Escalate ${contradicted.id} (${contradicted.label}) for human review — sources disagree.`,
      actor: "staff",
      rationale: "Available sources conflict; no automated action is safe.",
      expectedStateChange: "A staff member reconciles the conflicting sources.",
      requiresHumanApproval: true,
      targetCriterionId: contradicted.id,
    };
  }

  // 2. An unresolved criterion the patient can resolve → one targeted question.
  const patientResolvable = criteria.find(
    (c) => unresolved(c) && c.resolvableBy?.includes("patient_followup")
  );
  if (patientResolvable) {
    const question =
      patientResolvable.suggestedPatientQuestion ??
      `Can you tell us more about: ${patientResolvable.missingInformation?.join("; ") ?? patientResolvable.label}?`;
    return {
      id: actionId(),
      type: "ASK_PATIENT",
      description: question,
      actor: "patient",
      rationale: `${patientResolvable.id} (${patientResolvable.label}) is ${patientResolvable.status}: ${patientResolvable.missingInformation?.join("; ") ?? "details unresolved"}. Only the patient can supply this; it is the smallest action that unblocks the case.`,
      expectedStateChange: `${patientResolvable.id} moves to patient-reported with the missing details filled in; the next action becomes verifying what the patient reports.`,
      requiresHumanApproval: true,
      targetCriterionId: patientResolvable.id,
    };
  }

  // 3. Patient-reported evidence naming a facility → request the record.
  const patientReported = criteria.find(
    (c) =>
      c.status === "patient_reported" &&
      c.evidence.some((e) => e.sourceType === "patient_followup" && e.verificationStatus === "patient_reported")
  );
  if (patientReported) {
    const facility = patientReported.evidence.find(
      (e) => e.sourceType === "patient_followup" && e.concept === "facility"
    )?.value;
    return {
      id: actionId(),
      type: "REQUEST_RECORD",
      description: `Request the treatment record${facility ? ` from ${facility}` : ""} to verify the patient-reported history for ${patientReported.id} (${patientReported.label}). The patient can also upload their own copy.`,
      actor: "staff",
      rationale: `The patient's answer is stored as patient-reported, not verified. The record now has a known location${facility ? ` (${facility})` : ""}, so retrieving it is the smallest action that makes this criterion submission-ready.`,
      expectedStateChange: `${patientReported.id} moves from patient-reported to record-verified once the external record arrives.`,
      requiresHumanApproval: true,
      targetCriterionId: patientReported.id,
    };
  }

  // 4. Unresolved but only a clinician can resolve it.
  const clinicianResolvable = criteria.find((c) => unresolved(c));
  if (clinicianResolvable) {
    return {
      id: actionId(),
      type: "ASK_CLINICIAN",
      description: `Ask the clinician to address ${clinicianResolvable.id} (${clinicianResolvable.label}): ${clinicianResolvable.missingInformation?.join("; ") ?? "requires clinical judgment"}.`,
      actor: "clinician",
      rationale: "The remaining gap requires examination or clinical judgment, not patient recall.",
      expectedStateChange: `${clinicianResolvable.id} is resolved by clinician documentation.`,
      requiresHumanApproval: true,
      targetCriterionId: clinicianResolvable.id,
    };
  }

  // 5. Everything resolved (or pending only external verification) → draft the packet.
  return {
    id: actionId(),
    type: "GENERATE_PACKET",
    description: "Generate the draft prior-authorization evidence summary for human review.",
    actor: "system",
    rationale: criteria.every((c) => RESOLVED.has(c.status))
      ? "All criteria are supported by verified documentation."
      : "All criteria are documented or patient-reported with record retrieval underway; the case is ready for a review-ready draft.",
    expectedStateChange: "A provenance-linked draft summary is produced for human review. Nothing is submitted.",
    requiresHumanApproval: true,
  };
}