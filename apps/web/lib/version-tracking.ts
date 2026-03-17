// apps/web/lib/version-tracking.ts
// Creates ProductVersion and ChangePromotion records on shipBuild().

import { prisma } from "@dpf/db";
import * as crypto from "crypto";

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
