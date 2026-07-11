const REQUIRED_PROMOTE_ENV = [
  "PROMOTE_SOURCE",
  "PROMOTE_TARGET_SHA",
  "PROMOTE_BACKUP_PATH",
  "PROMOTE_HEALTH_URL",
] as const;

export type PromotionPromoterContractResult = {
  ok: boolean;
  missing: string[];
  message: string | null;
};

type PromotionContractFailure = {
  success: false;
  error: string;
  message: string;
  data: {
    promotionId: string;
    status: "approved";
    missingContract: string[];
  };
};

/**
 * Verify the Docker argv matches scripts/promote.sh before starting a
 * production-visible container. The promoter image now exposes only the
 * governed self-upgrade contract; legacy PROMOTION_ID argv must fail closed.
 */
export function validatePromotionPromoterContract(
  dockerArgs: readonly string[],
): PromotionPromoterContractResult {
  const missing: string[] = [];

  if (!dockerArgs.includes("--self-upgrade")) {
    missing.push("--self-upgrade");
  }

  for (const name of REQUIRED_PROMOTE_ENV) {
    if (!dockerArgs.some((arg) => arg.startsWith(`${name}=`))) {
      missing.push(name);
    }
  }

  if (missing.length === 0) {
    return { ok: true, missing, message: null };
  }

  return {
    ok: false,
    missing,
    message: `Promoter contract mismatch: missing ${missing.join(", ")}. Deployment was not started.`,
  };
}

export async function guardPromotionPromoterContract(input: {
  dockerArgs: readonly string[];
  promotionId: string;
  buildId: string | null | undefined;
}): Promise<PromotionContractFailure | null> {
  const contract = validatePromotionPromoterContract(input.dockerArgs);
  if (contract.ok) return null;

  const detail = contract.message ?? "Promoter contract validation failed.";
  const { prisma } = await import("@dpf/db");
  await prisma.changePromotion.update({
    where: { promotionId: input.promotionId },
    data: {
      deploymentLog: `[preflight] ${detail}`,
      rollbackReason: detail,
    },
  });
  await prisma.buildActivity.create({
    data: {
      buildId: input.buildId ?? input.promotionId,
      tool: "execute_promotion",
      summary: detail,
    },
  }).catch(() => {});

  return {
    success: false,
    error: "Promoter contract mismatch",
    message: detail,
    data: {
      promotionId: input.promotionId,
      status: "approved",
      missingContract: contract.missing,
    },
  };
}
