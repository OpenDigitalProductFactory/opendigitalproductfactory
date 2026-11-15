"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/actions/shared/guards";
import type { DecisionGateCaptureDraft } from "@/lib/decision-perspective/capture-types";
import { captureBuildDecisionAs, type BuildCaptureResult } from "@/lib/decision/owner-ruling-capture";

async function requireBuildCaptureUser(): Promise<string> {
  return (await requireCapability("view_platform")).userId;
}

/** The build workspace's capture control; the write is shared with record_owner_ruling (BI-0C0B0836). */
export async function captureDecisionInteraction(input: DecisionGateCaptureDraft & {
  buildId: string;
}): Promise<BuildCaptureResult> {
  const userId = await requireBuildCaptureUser();
  const result = await captureBuildDecisionAs(userId, input);
  revalidatePath("/build");
  return result;
}
