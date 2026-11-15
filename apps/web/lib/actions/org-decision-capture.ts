"use server";
// WWWD org-decision capture (BI-9677364B). The ruling itself is written by
// lib/decision/owner-ruling-capture.ts, shared with the coworker tool
// record_owner_ruling (BI-0C0B0836); this action is the portal's "Answer"
// control and keeps its own capability check.

import { revalidatePath } from "next/cache";

import { requireCapability } from "@/lib/actions/shared/guards";
import {
  captureOrgDecisionOutcomeAs,
  type CaptureOrgDecisionResult,
} from "@/lib/decision/owner-ruling-capture";
import type { OrgDecisionCaptureInput } from "@/lib/wiki/org-decision-capture";

/**
 * Record the owner's ruling on an unresolved WWWD business decision, and
 * optionally make it standing doctrine for the decision's class.
 */
export async function captureOrgDecisionOutcome(
  input: OrgDecisionCaptureInput,
): Promise<CaptureOrgDecisionResult> {
  let userId: string;
  try {
    userId = (await requireCapability("view_platform")).userId;
  } catch {
    return { ok: false, error: "You do not have access to answer decisions." };
  }
  const result = await captureOrgDecisionOutcomeAs(userId, input);
  if (result.ok && result.status === "captured") {
    revalidatePath("/coworker-decisions/review");
    revalidatePath("/coworker-decisions");
  }
  return result;
}
