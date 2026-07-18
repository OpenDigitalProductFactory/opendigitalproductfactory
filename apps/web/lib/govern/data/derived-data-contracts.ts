// apps/web/lib/govern/data/derived-data-contracts.ts
// BI-DG-002 (spec §6.4): typed contracts for every derived copy (Neo4j, Qdrant, cache,
// export, backup, federation). PURE + declarative. A projection cannot self-declassify:
// the strictest relevant source restriction propagates UNLESS a recorded transform
// produces a less-identifying output that the PDP authorizes. Every content-bearing
// contract MUST declare source-delete propagation + an orphan-reconciliation method so
// a source deletion is provably complete (the BI-DG-001 semantic-memory reconcile is a
// real instance of this contract).

import type { DataAssetId } from "./taxonomy";
import type { DestinationClass, ProjectionClass } from "./taxonomy";

/** How a source deletion reaches this derived copy. */
export type SourceDeletePropagation = "synchronous" | "queued" | "reconcile-only";

/** How orphaned derived records (source gone, copy missed the delete) are detected. */
export type OrphanReconciliationMethod = "source-anti-join" | "tombstone-scan" | "none";

export type DerivedDataContract = {
  id: string;
  sourceAssetId: DataAssetId;
  destination: DestinationClass;
  /** Store/index the copy lives in (human label, e.g. "qdrant:agent-memory"). */
  store: string;
  /** Most-identifying payload this copy may carry. */
  payloadClass: ProjectionClass;
  /** Named transform applied before projection, or null when copied structurally. */
  transformation: string | null;
  /** True when the transform lowers identifiability enough to justify payloadClass. */
  transformDowngradesIdentifiability: boolean;
  /** Field/relation path locating the source record for deletion + reconciliation. */
  subjectLocatorPath: string;
  sourceDeletePropagation: SourceDeletePropagation;
  orphanReconciliation: OrphanReconciliationMethod;
  /** Contract SLO (seconds) within which darkness/orphans must become visible. */
  reconciliationSloSeconds: number;
};

/** Thrown when a contract violates a §6.4 invariant. */
export class DerivedDataContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DerivedDataContractError";
  }
}

/**
 * Validate a contract against §6.4 invariants:
 *  - a content/masked-content copy MUST have delete propagation AND reconciliation
 *    (fire-and-forget is acceptable only when orphans become visible within the SLO);
 *  - a copy that carries `content` while claiming a downgrading transform is a
 *    contradiction (a real downgrade cannot still be full content);
 *  - `reconcile-only` propagation still requires a real reconciliation method.
 */
export function assertDerivedDataContract(contract: DerivedDataContract): void {
  const carriesContent =
    contract.payloadClass === "content" || contract.payloadClass === "masked-content";

  if (carriesContent && contract.sourceDeletePropagation === "reconcile-only"
    && contract.orphanReconciliation === "none") {
    throw new DerivedDataContractError(
      `${contract.id}: content-bearing copy needs a reconciliation method, not "none"`,
    );
  }
  if (carriesContent && contract.orphanReconciliation === "none") {
    throw new DerivedDataContractError(
      `${contract.id}: content-bearing copy must declare orphan reconciliation`,
    );
  }
  if (contract.payloadClass === "content" && contract.transformDowngradesIdentifiability) {
    throw new DerivedDataContractError(
      `${contract.id}: a downgrading transform cannot still project full "content"`,
    );
  }
  if (contract.reconciliationSloSeconds <= 0) {
    throw new DerivedDataContractError(`${contract.id}: reconciliation SLO must be positive`);
  }
}

const CONTRACTS: readonly DerivedDataContract[] = [
  {
    // The BI-DG-001 semantic-memory projection, expressed as a governed contract.
    id: "agent-conversation->qdrant-agent-memory",
    sourceAssetId: "data:agent-conversation",
    destination: "derived-index",
    store: "qdrant:agent-memory",
    payloadClass: "masked-content",
    transformation: "sensitivity-gate+deterministic-mask",
    transformDowngradesIdentifiability: true,
    subjectLocatorPath: "messageId",
    sourceDeletePropagation: "queued",
    orphanReconciliation: "source-anti-join",
    reconciliationSloSeconds: 24 * 60 * 60,
  },
];

for (const contract of CONTRACTS) assertDerivedDataContract(contract);

export const DERIVED_DATA_CONTRACTS = CONTRACTS;

const BY_ID: ReadonlyMap<string, DerivedDataContract> = new Map(CONTRACTS.map((c) => [c.id, c]));

export function getDerivedDataContract(id: string): DerivedDataContract | undefined {
  return BY_ID.get(id);
}

/** All derived-copy contracts fed by a given source asset (for delete propagation). */
export function contractsForSourceAsset(assetId: DataAssetId): readonly DerivedDataContract[] {
  return CONTRACTS.filter((c) => c.sourceAssetId === assetId);
}
