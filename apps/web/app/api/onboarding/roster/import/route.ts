import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { importRoster } from "@/lib/onboarding/roster-import-actions";
import type { ProposedEmployee } from "@/lib/onboarding/roster-import";

export const runtime = "nodejs";

// Create EmployeeProfile rows from operator-confirmed roster rows
// (EP-ONBOARDING-INTAKE P4). The confirm step is the gate — nothing is created
// until the operator reviews the preview and submits.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { confirmed?: ProposedEmployee[] };
  if (!Array.isArray(body.confirmed) || body.confirmed.length === 0) {
    return NextResponse.json({ error: "No employees to import." }, { status: 400 });
  }

  const MAX = 2000;
  const result = await importRoster(body.confirmed.slice(0, MAX));
  return NextResponse.json({ success: true, ...result });
}
