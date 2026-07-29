import { randomUUID } from "node:crypto";

import {
  reviewedKnowledgeIsEligible,
  validateDemandEvidenceInput,
  type DemandEvidenceInput,
} from "./evidence";

export type DemandEvidenceDb = {
  backlogItem: {
    findUnique: (args: unknown) => Promise<{
      id: string;
      itemId: string;
      organizationId: string | null;
    } | null>;
  };
  wikiPage: {
    findFirst: (args: unknown) => Promise<{
      id: string;
      slug: string;
      title: string;
      abstract: string | null;
      status: string;
      lastReviewedAt: Date | null;
      organizationId: string | null;
      isKernel: boolean;
    } | null>;
  };
  demandEvidenceLink: {
    upsert: (args: unknown) => Promise<{
      evidenceLinkId: string;
      sourceKind: string;
      sourceRef: string;
      title: string;
      status: string;
    }>;
    findUnique: (args: unknown) => Promise<{
      id: string;
      evidenceLinkId: string;
      backlogItemId: string;
      sourceKind: string;
      sourceRef: string;
      title: string;
      status: string;
    } | null>;
    update: (args: unknown) => Promise<unknown>;
  };
  backlogItemActivity: {
    create: (args: unknown) => Promise<unknown>;
  };
  $transaction: (
    operations: unknown[],
  ) => Promise<unknown[]>;
};

export type LinkDemandEvidenceInput = DemandEvidenceInput & {
  itemId: string;
  linkedByPrincipalId?: string | null;
  recordedByUserId?: string | null;
  provenance?: Record<string, unknown> | null;
};

export type DemandEvidenceRepositoryResult =
  | {
      ok: true;
      evidenceLinkId: string;
      sourceKind: string;
      sourceRef: string;
      title: string;
      status: string;
    }
  | { ok: false; code: string; message: string };

export async function linkDemandEvidence(
  db: DemandEvidenceDb,
  input: LinkDemandEvidenceInput,
): Promise<DemandEvidenceRepositoryResult> {
  const itemId = input.itemId.trim();
  const item = await db.backlogItem.findUnique({
    where: { itemId },
    select: { id: true, itemId: true, organizationId: true },
  });
  if (!item) {
    return { ok: false, code: "not-found", message: `Demand ${itemId} was not found.` };
  }

  const validated = validateDemandEvidenceInput(input);
  if (!validated.valid) {
    return { ok: false, code: "invalid-evidence", message: validated.message };
  }
  let value = validated.value;
  let wikiPageId: string | null = null;

  if (value.sourceKind === "reviewed-knowledge") {
    const page = await db.wikiPage.findFirst({
      where: {
        OR: [{ id: value.sourceRef }, { slug: value.sourceRef }],
      },
      select: {
        id: true,
        slug: true,
        title: true,
        abstract: true,
        status: true,
        lastReviewedAt: true,
        organizationId: true,
        isKernel: true,
      },
    });
    if (
      !page ||
      !reviewedKnowledgeIsEligible({
        status: page.status,
        lastReviewedAt: page.lastReviewedAt,
        pageOrganizationId: page.organizationId,
        demandOrganizationId: item.organizationId,
        isKernel: page.isKernel,
      })
    ) {
      return {
        ok: false,
        code: "knowledge-not-reviewed",
        message:
          "Choose published knowledge that has been reviewed for this organization.",
      };
    }
    wikiPageId = page.id;
    value = {
      ...value,
      sourceRef: page.slug,
      title: page.title,
      summary: page.abstract ?? value.summary,
      reviewedAt: page.lastReviewedAt,
    };
  } else if (value.reviewedAt === null) {
    // Linking is the explicit human/coworker review act for source-domain
    // evidence. Preserve when that review occurred; do not claim the source
    // itself was created or modified at this time.
    value = { ...value, reviewedAt: new Date() };
  }

  const evidenceLinkId = `DME-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  const linked = await db.demandEvidenceLink.upsert({
    where: {
      backlogItemId_sourceKind_sourceRef: {
        backlogItemId: item.id,
        sourceKind: value.sourceKind,
        sourceRef: value.sourceRef,
      },
    },
    update: {
      title: value.title,
      summary: value.summary,
      confidence: value.confidence,
      reviewedAt: value.reviewedAt,
      wikiPageId,
      status: "active",
      provenance: input.provenance ?? undefined,
      linkedByPrincipalId: input.linkedByPrincipalId ?? undefined,
    },
    create: {
      evidenceLinkId,
      backlogItemId: item.id,
      sourceKind: value.sourceKind,
      sourceRef: value.sourceRef,
      wikiPageId,
      title: value.title,
      summary: value.summary,
      confidence: value.confidence,
      reviewedAt: value.reviewedAt,
      status: "active",
      provenance: input.provenance ?? undefined,
      linkedByPrincipalId: input.linkedByPrincipalId ?? undefined,
    },
    select: {
      evidenceLinkId: true,
      sourceKind: true,
      sourceRef: true,
      title: true,
      status: true,
    },
  });
  await db.backlogItemActivity.create({
    data: {
      backlogItemId: item.id,
      kind: "demand_evidence_linked",
      summary: `Linked ${linked.title}`,
      payload: {
        evidenceLinkId: linked.evidenceLinkId,
        sourceKind: linked.sourceKind,
        sourceRef: linked.sourceRef,
        reviewedAt: value.reviewedAt?.toISOString() ?? null,
        confidence: value.confidence,
        linkedByPrincipalId: input.linkedByPrincipalId ?? null,
      },
      recordedById: input.recordedByUserId ?? null,
    },
  });
  return { ok: true, ...linked };
}

export async function supersedeDemandEvidence(
  db: DemandEvidenceDb,
  input: {
    evidenceLinkId: string;
    rationale: string;
    recordedByUserId?: string | null;
    recordedByPrincipalId?: string | null;
  },
): Promise<DemandEvidenceRepositoryResult> {
  const rationale = input.rationale.trim();
  if (!rationale) {
    return {
      ok: false,
      code: "rationale-required",
      message: "Explain why this evidence no longer supports the demand.",
    };
  }
  const link = await db.demandEvidenceLink.findUnique({
    where: { evidenceLinkId: input.evidenceLinkId },
    select: {
      id: true,
      evidenceLinkId: true,
      backlogItemId: true,
      sourceKind: true,
      sourceRef: true,
      title: true,
      status: true,
    },
  });
  if (!link) {
    return {
      ok: false,
      code: "not-found",
      message: "The evidence link was not found.",
    };
  }
  await db.$transaction([
    db.demandEvidenceLink.update({
      where: { id: link.id },
      data: { status: "superseded" },
    }),
    db.backlogItemActivity.create({
      data: {
        backlogItemId: link.backlogItemId,
        kind: "demand_evidence_superseded",
        summary: "Evidence link superseded",
        payload: {
          evidenceLinkId: link.evidenceLinkId,
          rationale,
          recordedByPrincipalId: input.recordedByPrincipalId ?? null,
        },
        recordedById: input.recordedByUserId ?? null,
      },
    }),
  ]);
  return {
    ok: true,
    evidenceLinkId: link.evidenceLinkId,
    sourceKind: link.sourceKind,
    sourceRef: link.sourceRef,
    title: link.title,
    status: "superseded",
  };
}
