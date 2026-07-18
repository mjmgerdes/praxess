import { NextRequest, NextResponse } from "next/server";
import { extractObservation } from "@/lib/claude";
import { applyObservation } from "@/lib/case";
import type { CaseState } from "@/lib/types";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const { caseState, observationText } = (await req.json()) as {
      caseState: CaseState;
      observationText: string;
    };
    if (!observationText?.trim()) {
      return NextResponse.json({ error: "empty observation" }, { status: 400 });
    }
    const action = caseState.recommendedAction;
    const targetCriterionId = action.targetCriterionId ?? "LBP-2";
    const extraction = await extractObservation(
      observationText,
      targetCriterionId,
      action.description
    );
    const updated = applyObservation(caseState, extraction, observationText.trim());
    return NextResponse.json({ caseState: updated });
  } catch (err) {
    console.error("observe failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "observation failed" },
      { status: 500 }
    );
  }
}
