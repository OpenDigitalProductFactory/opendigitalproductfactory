// Prisma binding for the estate patch-assessment projector.
//
// Implements the packages/db PatchAssessmentStore port against the live database:
//   - listSoftwareEvidence  -> DiscoveredSoftwareEvidence rows
//   - upsertFinding         -> the canonical persistAssuranceFindings writer
//   - resolveFindingsExcept -> resolve now-clean patch findings (patch:* key scope)
//
// Decoupled behind a minimal db subset (the house "Prisma read/write subset" pattern)
// so the whole flow is unit-testable with a fake db; the real PrismaClient satisfies it
// structurally via a single boundary cast in the scheduled job.

import {
  runPatchAssessment,
  type PatchAssessmentStore,
  type PatchAssessmentSummary,
  type PatchFindingUpsert,
  type PatchIntelProvider,
  type SoftwareEvidenceLike,
} from "@dpf/db/patch";

import { persistAssuranceFindings } from "../assurance/finding-persistence";
import { toNormalizedAssuranceFinding } from "./finding-mapping";

const PATCH_ADAPTER_KEY = "patch-intel";
const PATCH_ADAPTER_VERSION = "1.0.0";
const PATCH_FINDING_KEY_PREFIX = "patch:";
// Non-terminal statuses a now-clean patch finding may be auto-resolved FROM. `accepted`
// (intentional risk) and `deferred` (parked) are left alone — mirrors finding-persistence.
const ACTIVE_RESOLVABLE_STATUSES = ["open", "planned", "blocked"];

/** Minimal db surface the store needs; satisfied by PrismaClient and test fakes. */
export interface PatchStoreDb {
  discoveredSoftwareEvidence: { findMany(args: unknown): Promise<unknown[]> };
  assuranceRun: {
    create(args: unknown): Promise<{ id: string }>;
    update(args: unknown): Promise<unknown>;
  };
  assuranceFinding: {
    findMany(args: unknown): Promise<unknown[]>;
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

interface EvidenceRow {
  id: string;
  evidenceKey: string;
  inventoryEntityId: string;
  rawVendor: string | null;
  rawProductName: string | null;
  rawPackageName: string | null;
  rawVersion: string | null;
  packageManager: string | null;
  catalogIdentity?: CatalogIdentityRow | null;
  inventoryEntity?: {
    customerAccountId?: string | null;
    customerSiteId?: string | null;
    catalogIdentity?: CatalogIdentityRow | null;
  } | null;
}

interface CatalogIdentityRow {
  id: string;
  cpe: string | null;
  part: string | null;
  lifecycleMilestones?: Array<{
    milestone: string;
    date: Date | string | null;
    source?: string | null;
    confidence?: number | null;
  }> | null;
}

function evidenceToSoftwareLike(row: EvidenceRow): SoftwareEvidenceLike {
  const identity = row.catalogIdentity ?? row.inventoryEntity?.catalogIdentity ?? null;
  return {
    id: row.id,
    evidenceKey: row.evidenceKey,
    inventoryEntityId: row.inventoryEntityId,
    rawVendor: row.rawVendor,
    rawProductName: row.rawProductName,
    rawPackageName: row.rawPackageName,
    rawVersion: row.rawVersion,
    packageManager: row.packageManager,
    customerAccountId: row.inventoryEntity?.customerAccountId ?? null,
    customerSiteId: row.inventoryEntity?.customerSiteId ?? null,
    catalogIdentityId: identity?.id ?? null,
    catalogIdentityCpe: identity?.cpe ?? null,
    catalogIdentityPart: identity?.part ?? null,
    catalogLifecycleMilestones: identity?.lifecycleMilestones ?? [],
  };
}

/** Build a store bound to a specific AssuranceRun. */
export function createPrismaPatchStore(
  db: PatchStoreDb,
  options: { assuranceRunId: string; now: Date },
): PatchAssessmentStore {
  return {
    async listSoftwareEvidence(): Promise<SoftwareEvidenceLike[]> {
      const rows = (await db.discoveredSoftwareEvidence.findMany({
        select: {
          id: true,
          evidenceKey: true,
          inventoryEntityId: true,
          rawVendor: true,
          rawProductName: true,
          rawPackageName: true,
          rawVersion: true,
          packageManager: true,
          catalogIdentity: {
            select: {
              id: true,
              cpe: true,
              part: true,
              lifecycleMilestones: {
                select: { milestone: true, date: true, source: true, confidence: true },
              },
            },
          },
          inventoryEntity: {
            select: {
              customerAccountId: true,
              customerSiteId: true,
              catalogIdentity: {
                select: {
                  id: true,
                  cpe: true,
                  part: true,
                  lifecycleMilestones: {
                    select: { milestone: true, date: true, source: true, confidence: true },
                  },
                },
              },
            },
          },
        },
      })) as EvidenceRow[];
      return rows.map(evidenceToSoftwareLike);
    },

    async upsertFinding(finding: PatchFindingUpsert): Promise<void> {
      await persistAssuranceFindings(db, {
        assuranceRunId: options.assuranceRunId,
        findings: [toNormalizedAssuranceFinding(finding)],
        observedAt: options.now,
      });
    },

    async resolveFindingsExcept(activeFindingKeys: string[]): Promise<number> {
      const result = await db.assuranceFinding.updateMany({
        where: {
          AND: [
            { findingKey: { startsWith: PATCH_FINDING_KEY_PREFIX } },
            { findingKey: { notIn: activeFindingKeys } },
          ],
          status: { in: ACTIVE_RESOLVABLE_STATUSES },
        },
        data: { status: "resolved", resolvedAt: options.now },
      });
      return result.count;
    },
  };
}

/**
 * Run a full estate patch assessment: open an AssuranceRun, project discovered software
 * into patch findings via the injected intelligence provider, and close the run with a
 * posture summary. Returns the summary. The provider is injected so the live OSV/KEV feed
 * (and a test stub) plug in without changing this orchestration.
 */
export async function runEstatePatchAssessment(
  db: PatchStoreDb,
  provider: PatchIntelProvider,
  options: { now: Date; scopeId?: string },
): Promise<PatchAssessmentSummary> {
  const at = options.now;
  const run = await db.assuranceRun.create({
    data: {
      runId: `assurance_patch_${at.toISOString()}`,
      scopeType: "estate",
      scopeId: options.scopeId ?? "platform",
      adapterKey: PATCH_ADAPTER_KEY,
      adapterVersion: PATCH_ADAPTER_VERSION,
      status: "running",
      startedAt: at,
    },
  });

  const store = createPrismaPatchStore(db, { assuranceRunId: run.id, now: at });
  const summary = await runPatchAssessment(store, provider, { now: at });

  await db.assuranceRun.update({
    where: { id: run.id },
    data: { status: "passed", completedAt: at, summary },
  });

  return summary;
}
