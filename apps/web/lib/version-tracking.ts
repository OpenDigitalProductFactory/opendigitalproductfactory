// apps/web/lib/version-tracking.ts
// Creates ProductVersion and ChangePromotion records on shipBuild().

import { prisma } from "@dpf/db";
import * as crypto from "crypto";
import { generateRfcId } from "./actions/change-management";

export function generatePromotionId(): string {
  return `CP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function createProductVersion(opts: {
  digitalProductId: string;
  version: string;
  gitTag: string;
  gitCommitHash: string;
  featureBuildId?: string;
  shippedBy: string;
  changeCount?: number;
  changeSummary?: string;
}): Promise<{ versionId: string; promotionId: string }> {
  const promotionId = generatePromotionId();

  const productVersion = await prisma.productVersion.create({
    data: {
      digitalProductId: opts.digitalProductId,
      version: opts.version,
      gitTag: opts.gitTag,
      gitCommitHash: opts.gitCommitHash,
      featureBuildId: opts.featureBuildId ?? null,
      shippedBy: opts.shippedBy,
      changeCount: opts.changeCount ?? 0,
      changeSummary: opts.changeSummary ?? null,
    },
    select: { id: true },
  });

  await prisma.changePromotion.create({
    data: {
      promotionId,
      productVersionId: productVersion.id,
      status: "pending",
      requestedBy: opts.shippedBy,
    },
  });

  return { versionId: productVersion.id, promotionId };
}

/**
 * Creates a ProductVersion + ChangePromotion + wrapping ChangeRequest (RFC)
 * in a single transaction. Used by shipBuild() to ensure every promotion
 * is wrapped in an RFC that requires human approval.
 */
export async function createProductVersionWithRFC(input: {
  digitalProductId: string;
  version: string;
  gitTag: string;
  gitCommitHash: string;
  shippedBy: string;
  featureBuildId?: string;
  changeSummary?: string;
}): Promise<{
  version: { id: string };
  promotion: { id: string; promotionId: string };
  rfc: { id: string; rfcId: string };
}> {
  const promotionId = generatePromotionId();
  const rfcId = await generateRfcId();

  return prisma.$transaction(async (tx) => {
    // 1. Create ProductVersion
    const productVersion = await tx.productVersion.create({
      data: {
        digitalProductId: input.digitalProductId,
        version: input.version,
        gitTag: input.gitTag,
        gitCommitHash: input.gitCommitHash,
        featureBuildId: input.featureBuildId ?? null,
        shippedBy: input.shippedBy,
        changeCount: 0,
        changeSummary: input.changeSummary ?? null,
      },
      select: { id: true },
    });

    // 2. Create ChangePromotion
    const promotion = await tx.changePromotion.create({
      data: {
        promotionId,
        productVersionId: productVersion.id,
        status: "pending",
        requestedBy: input.shippedBy,
      },
      select: { id: true },
    });

    // 3. Create wrapping RFC (always normal type, always draft status)
    const rfc = await tx.changeRequest.create({
      data: {
        rfcId,
        title: `Ship v${input.version}`,
        description: input.changeSummary ?? `Promotion ${promotionId} for v${input.version}`,
        type: "normal",
        scope: "platform",
        riskLevel: "low",
        status: "draft",
      },
      select: { id: true },
    });

    // 4. Create ChangeItem linking RFC to the promotion
    await tx.changeItem.create({
      data: {
        changeRequestId: rfc.id,
        changePromotionId: promotion.id,
        itemType: "promotion",
        title: `Promote v${input.version}`,
        description: input.changeSummary ?? null,
      },
    });

    return {
      version: { id: productVersion.id },
      promotion: { id: promotion.id, promotionId },
      rfc: { id: rfc.id, rfcId },
    };
  });
}
