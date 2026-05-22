import type { NormalizedAssuranceFinding } from "./types";

export interface PersistAssuranceFindingsInput {
  assuranceRunId: string;
  findings: NormalizedAssuranceFinding[];
  observedAt: Date;
  buildId?: string | null;
  digitalProductId?: string | null;
  bomDocumentId?: string | null;
  componentIdsByAffectedId?: Record<string, string>;
}

export interface PersistAssuranceFindingsResult {
  created: number;
  updated: number;
  reopened: number;
}

type ExistingFinding = {
  findingKey: string;
  status: string;
  reopenCount: number;
};

type AssuranceFindingDelegate = {
  findMany(args: unknown): Promise<ExistingFinding[]>;
  create(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
};

export type AssuranceFindingPersistenceDb = {
  assuranceFinding: AssuranceFindingDelegate;
};

const REOPEN_STATUSES = new Set(["resolved"]);

function componentIdFor(input: PersistAssuranceFindingsInput, finding: NormalizedAssuranceFinding): string | null {
  if (finding.affectedType !== "bom-component") return null;
  return input.componentIdsByAffectedId?.[finding.affectedId] ?? null;
}

function baseFindingData(input: PersistAssuranceFindingsInput, finding: NormalizedAssuranceFinding) {
  return {
    assuranceRunId: input.assuranceRunId,
    buildId: input.buildId ?? null,
    digitalProductId: input.digitalProductId ?? null,
    bomDocumentId: input.bomDocumentId ?? null,
    bomComponentId: componentIdFor(input, finding),
    findingKind: finding.findingKind,
    title: finding.title,
    description: finding.description ?? null,
    affectedType: finding.affectedType,
    affectedId: finding.affectedId,
    adapterKey: finding.adapterKey,
    vendorIdentifier: finding.vendorIdentifier,
    sourceSeverity: finding.sourceSeverity ?? null,
    policySeverity: finding.policySeverity,
    releaseImpact: finding.releaseImpact,
    reachability: finding.reachability,
    exposure: finding.exposure,
    identifierStability: finding.identifierStability,
    source: {
      adapterKey: finding.adapterKey,
      vendorIdentifier: finding.vendorIdentifier,
    },
    evidence: finding.evidence,
    remediationHint: finding.remediationHint,
    lastSeenAt: input.observedAt,
  };
}

export async function persistAssuranceFindings(
  db: AssuranceFindingPersistenceDb,
  input: PersistAssuranceFindingsInput,
): Promise<PersistAssuranceFindingsResult> {
  if (input.findings.length === 0) {
    return { created: 0, updated: 0, reopened: 0 };
  }

  const keys = input.findings.map((finding) => finding.findingKey);
  const existingRows = await db.assuranceFinding.findMany({
    where: { findingKey: { in: keys } },
    select: { findingKey: true, status: true, reopenCount: true },
  });
  const existingByKey = new Map(existingRows.map((row) => [row.findingKey, row]));
  const result: PersistAssuranceFindingsResult = { created: 0, updated: 0, reopened: 0 };

  for (const finding of input.findings) {
    const existing = existingByKey.get(finding.findingKey);
    const data = baseFindingData(input, finding);

    if (!existing) {
      await db.assuranceFinding.create({
        data: {
          findingKey: finding.findingKey,
          ...data,
          status: "open",
          firstSeenAt: input.observedAt,
        },
      });
      result.created += 1;
      continue;
    }

    const updateData: Record<string, unknown> = { ...data };
    if (REOPEN_STATUSES.has(existing.status)) {
      updateData.status = "open";
      updateData.resolvedAt = null;
      updateData.reopenCount = { increment: 1 };
      result.reopened += 1;
    }

    await db.assuranceFinding.update({
      where: { findingKey: finding.findingKey },
      data: updateData,
    });
    result.updated += 1;
  }

  return result;
}
