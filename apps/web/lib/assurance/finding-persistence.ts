import type { NormalizedAssuranceFinding } from "./types";

export interface PersistAssuranceFindingsInput {
  assuranceRunId: string;
  findings: NormalizedAssuranceFinding[];
  observedAt: Date;
  buildId?: string | null;
  digitalProductId?: string | null;
  bomDocumentId?: string | null;
  componentIdsByAffectedId?: Record<string, string>;
  /**
   * P3 (BI-4D5C702F) — close the remediation loop's far end. When set, auto-resolve
   * previously-open findings for this build+adapter scope that are ABSENT from the
   * current scan: the remediation deployed and the vuln is gone. Without this,
   * persist only ever touches findings PRESENT in the scan, so a resolved finding
   * (and the gate's blocking state) lingers forever. Scoped strictly to
   * buildId + adapterKey so one adapter's clean scan can't false-resolve another's.
   */
  resolveAbsent?: { adapterKey: string };
}

export interface PersistAssuranceFindingsResult {
  created: number;
  updated: number;
  reopened: number;
  /** Findings auto-resolved because they vanished from the latest scan (P3). */
  resolved: number;
  /** Linked BI ids of the auto-resolved findings, for downstream BI close-out. */
  resolvedBacklogItemIds: string[];
}

type ExistingFinding = {
  findingKey: string;
  status: string;
  reopenCount: number;
};

type AbsentFinding = {
  findingKey: string;
  evidence: unknown;
};

type AssuranceFindingDelegate = {
  findMany(args: unknown): Promise<unknown[]>;
  create(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
};

export type AssuranceFindingPersistenceDb = {
  assuranceFinding: AssuranceFindingDelegate;
};

const REOPEN_STATUSES = new Set(["resolved"]);

/** Non-terminal statuses an absent finding may be auto-resolved FROM. `accepted`
 *  (intentional) and `deferred` (parked) are deliberately left alone. */
const ACTIVE_RESOLVABLE_STATUSES = ["open", "planned", "blocked"];

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

function readBacklogItemId(evidence: unknown): string | null {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const value = (evidence as Record<string, unknown>).backlogItemId;
  return typeof value === "string" && value ? value : null;
}

function withAutoResolved(evidence: unknown, at: Date): Record<string, unknown> {
  const base =
    evidence && typeof evidence === "object" && !Array.isArray(evidence)
      ? { ...(evidence as Record<string, unknown>) }
      : {};
  return { ...base, autoResolved: { reason: "not-seen-in-scan", at: at.toISOString() } };
}

export async function persistAssuranceFindings(
  db: AssuranceFindingPersistenceDb,
  input: PersistAssuranceFindingsInput,
): Promise<PersistAssuranceFindingsResult> {
  const result: PersistAssuranceFindingsResult = {
    created: 0,
    updated: 0,
    reopened: 0,
    resolved: 0,
    resolvedBacklogItemIds: [],
  };

  const keys = input.findings.map((finding) => finding.findingKey);

  // Upsert the findings present in this scan (create new, reopen resolved).
  if (input.findings.length > 0) {
    const existingRows = (await db.assuranceFinding.findMany({
      where: { findingKey: { in: keys } },
      select: { findingKey: true, status: true, reopenCount: true },
    })) as ExistingFinding[];
    const existingByKey = new Map(existingRows.map((row) => [row.findingKey, row]));

    for (const finding of input.findings) {
      const existing = existingByKey.get(finding.findingKey);
      const data = baseFindingData(input, finding);

      if (!existing) {
        await db.assuranceFinding.create({
          data: { findingKey: finding.findingKey, ...data, status: "open", firstSeenAt: input.observedAt },
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

      await db.assuranceFinding.update({ where: { findingKey: finding.findingKey }, data: updateData });
      result.updated += 1;
    }
  }

  // P3: auto-resolve findings that vanished from this scan (build+adapter scope).
  // Runs even when the scan is empty (everything fixed → resolve all active).
  if (input.resolveAbsent && input.buildId) {
    const absent = (await db.assuranceFinding.findMany({
      where: {
        buildId: input.buildId,
        adapterKey: input.resolveAbsent.adapterKey,
        status: { in: ACTIVE_RESOLVABLE_STATUSES },
        findingKey: { notIn: keys },
      },
      select: { findingKey: true, evidence: true },
    })) as AbsentFinding[];

    for (const row of absent) {
      await db.assuranceFinding.update({
        where: { findingKey: row.findingKey },
        data: {
          status: "resolved",
          resolvedAt: input.observedAt,
          evidence: withAutoResolved(row.evidence, input.observedAt),
        },
      });
      result.resolved += 1;
      const backlogItemId = readBacklogItemId(row.evidence);
      if (backlogItemId) result.resolvedBacklogItemIds.push(backlogItemId);
    }
  }

  return result;
}
