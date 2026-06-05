// GET /api/v1/device-catalog — the public, PII-free device-identification
// catalog (spec §7): fingerprint → identity → DPPM placement, versioned with
// the catalog schemaVersion. Read-only, unauthenticated, cacheable.

import { NextResponse } from "next/server";
import {
  prisma,
  buildPublicDeviceCatalog,
  type PublicCatalogRuleInput,
  type FingerprintMatchExpression,
  type ResolvedIdentity,
} from "@dpf/db";

export async function GET() {
  try {
    const rules = await prisma.discoveryFingerprintRule.findMany({
      where: { status: "active", scope: "global" },
      select: {
        ruleKey: true,
        status: true,
        scope: true,
        matchExpression: true,
        requiredEvidenceFamilies: true,
        resolvedIdentity: true,
        identityConfidence: true,
        taxonomyConfidence: true,
        taxonomyNode: { select: { nodeId: true } },
      },
    });

    const input: PublicCatalogRuleInput[] = rules.map(
      (r: {
        ruleKey: string;
        status: string;
        scope: string;
        matchExpression: unknown;
        requiredEvidenceFamilies: string[];
        resolvedIdentity: unknown;
        identityConfidence: number;
        taxonomyConfidence: number;
        taxonomyNode: { nodeId: string } | null;
      }) => ({
        ruleKey: r.ruleKey,
        status: r.status,
        scope: r.scope,
        matchExpression: r.matchExpression as FingerprintMatchExpression,
        requiredEvidenceFamilies: r.requiredEvidenceFamilies,
        resolvedIdentity: (r.resolvedIdentity ?? {}) as ResolvedIdentity,
        taxonomyNodeId: r.taxonomyNode?.nodeId ?? null,
        identityConfidence: r.identityConfidence,
        taxonomyConfidence: r.taxonomyConfidence,
      }),
    );

    const catalog = buildPublicDeviceCatalog(input);
    return NextResponse.json(catalog, {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch {
    return NextResponse.json({ code: "INTERNAL_ERROR", message: "Failed to build device catalog" }, { status: 500 });
  }
}
