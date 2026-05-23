"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getLatestBomSummaryForBuild, missingBomSummary } from "@/lib/assurance/bom-read";
import type { BomSummary } from "@/lib/assurance/bom-read";
import { queueBuildBomGeneration } from "@/lib/assurance/bom-trigger";
import { queueBuildAssuranceScan } from "@/lib/assurance/scan-trigger";
import {
  createBacklogItemFromFinding,
  updateAssuranceFindingStatus,
  type CreateBacklogFromFindingResult,
  type UpdateFindingStatusResult,
} from "@/lib/assurance/finding-actions";
import {
  listActiveFindingsForBuild,
  listActiveFindingsForProduct,
  type ActiveAssuranceFindingRow,
} from "@/lib/assurance/finding-read";
import type { AssuranceFindingStatus } from "@/lib/assurance/types";

async function requirePlatformUser(): Promise<string> {
  const session = await auth();
  const user = session?.user;

  if (!user?.id || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_platform")) {
    throw new Error("Unauthorized");
  }

  return user.id;
}

export async function requestBuildBomGeneration(buildId: string): Promise<{ queued: true }> {
  const requestedByUserId = await requirePlatformUser();
  await queueBuildBomGeneration({ buildId, requestedByUserId });
  return { queued: true };
}

export async function requestBuildAssuranceScan(buildId: string): Promise<{ queued: true }> {
  const requestedByUserId = await requirePlatformUser();
  await queueBuildAssuranceScan({ buildId, requestedByUserId });
  return { queued: true };
}

export async function getBuildBomSummary(buildId: string): Promise<BomSummary> {
  try {
    return await getLatestBomSummaryForBuild(prisma, buildId);
  } catch (err) {
    console.error(
      `[tool-trace] failed to load build BOM summary buildId=${JSON.stringify(buildId)} error=${
        JSON.stringify(err instanceof Error ? err.message : String(err))
      }`,
    );
    return missingBomSummary();
  }
}

export async function getBuildAssuranceFindings(
  buildId: string,
  limit = 25,
): Promise<ActiveAssuranceFindingRow[]> {
  try {
    return await listActiveFindingsForBuild(prisma, buildId, limit);
  } catch (err) {
    // CodeQL js/log-injection: JSON.stringify is a built-in taint sanitiser
    // for log lines — it escapes CR/LF and quotes the value, preventing
    // CRLF log forgery (CWE-117). safe-log's sanitizeForLog is the longer-
    // term registered sanitiser but only takes effect once the repo's
    // CodeQL setup flips to Advanced (see codeql.yml).
    console.error(
      "[tool-trace] failed to load build assurance findings buildId=%s error=%s",
      JSON.stringify(buildId),
      JSON.stringify(err instanceof Error ? err.message : String(err)),
    );
    return [];
  }
}

export async function getProductAssuranceFindings(
  digitalProductId: string,
  limit = 25,
): Promise<ActiveAssuranceFindingRow[]> {
  try {
    return await listActiveFindingsForProduct(prisma, digitalProductId, limit);
  } catch (err) {
    console.error(
      "[tool-trace] failed to load product assurance findings productId=%s error=%s",
      JSON.stringify(digitalProductId),
      JSON.stringify(err instanceof Error ? err.message : String(err)),
    );
    return [];
  }
}

export interface SetAssuranceFindingStatusInput {
  findingKey: string;
  status: AssuranceFindingStatus;
  reason?: string;
}

export async function setAssuranceFindingStatus(
  input: SetAssuranceFindingStatusInput,
): Promise<UpdateFindingStatusResult> {
  const userId = await requirePlatformUser();
  return updateAssuranceFindingStatus(prisma, {
    findingKey: input.findingKey,
    status: input.status,
    reason: input.reason,
    userId,
    now: new Date(),
  });
}

export async function requestBacklogFromAssuranceFinding(
  findingKey: string,
): Promise<CreateBacklogFromFindingResult> {
  const userId = await requirePlatformUser();
  return createBacklogItemFromFinding(prisma, {
    findingKey,
    userId,
    now: new Date(),
  });
}
