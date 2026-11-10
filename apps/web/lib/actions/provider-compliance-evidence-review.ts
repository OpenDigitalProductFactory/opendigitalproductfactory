"use server";

import { prisma, type Prisma } from "@dpf/db";
import { PROVIDER_COMPLIANCE_SOURCE_REGISTRY } from "@dpf/db/provider-compliance-source-registry";
import { revalidatePath } from "next/cache";

import { requireCapability } from "@/lib/actions/shared/guards";
import {
  providerComplianceReviewUpdate,
  type ProviderComplianceReviewDecision,
} from "./provider-compliance-evidence-review-state";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";

export async function reviewProviderComplianceEvidence(input: {
  sourceKey: string;
  decision: ProviderComplianceReviewDecision;
}): Promise<ActionResult<{ message: string }>> {
  const { userId } = await requireCapability("manage_compliance");
  if (!(input.sourceKey in PROVIDER_COMPLIANCE_SOURCE_REGISTRY)) {
    return err("That cited source is not governed by DPF.");
  }
  const source = await prisma.rawSource.findUnique({
    where: { sourceKey: input.sourceKey },
    select: { id: true, locator: true },
  });
  if (!source) return err("The evidence record is not installed yet.");

  await prisma.rawSource.update({
    where: { id: source.id },
    data: (() => {
      const update = providerComplianceReviewUpdate({
        decision: input.decision,
        reviewedAt: new Date(),
        reviewerId: userId,
        existingLocator: source.locator,
      });
      return { ...update, locator: update.locator as Prisma.InputJsonValue };
    })(),
  });
  revalidatePath("/workspace/inbox");
  return ok({
    message: input.decision === "confirmed"
      ? "Confirmed. The evidence date is renewed."
      : "Flagged as changed. The evidence remains out of date.",
  });
}
