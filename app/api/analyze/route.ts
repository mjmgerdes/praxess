import { NextResponse } from "next/server";
import { loadEncounter, loadPolicy } from "@/lib/data";
import { analyzeCriteria } from "@/lib/claude";
import { constructCaseState } from "@/lib/case";

export const maxDuration = 300;

export async function POST() {
  try {
    const encounter = loadEncounter();
    const policy = loadPolicy();
    const analysis = await analyzeCriteria(encounter.sources, policy);
    const caseState = constructCaseState(analysis, policy, encounter.sources, {
      patientName: encounter.patientName,
      caseId: encounter.encounterId,
    });
    return NextResponse.json({
      caseState,
      sources: { ...encounter.sources, patient_followup: "" },
      encounter: {
        date: encounter.encounterDate,
        visitTitle: encounter.visitTitle,
      },
    });
  } catch (err) {
    console.error("analyze failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "analysis failed" },
      { status: 500 }
    );
  }
}
