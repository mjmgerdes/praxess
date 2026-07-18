import { NextRequest, NextResponse } from "next/server";
import { draftPacket } from "@/lib/claude";
import { loadPolicy } from "@/lib/data";
import type { CaseState } from "@/lib/types";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const { caseState } = (await req.json()) as { caseState: CaseState };
    const policy = loadPolicy();
    const markdown = await draftPacket(caseState, policy);
    return NextResponse.json({ markdown });
  } catch (err) {
    console.error("packet failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "packet drafting failed" },
      { status: 500 }
    );
  }
}
