// apps/web/lib/govern/data/derived-data-contracts.test.ts
import { describe, expect, it } from "vitest";
import {
  DERIVED_DATA_CONTRACTS,
  DerivedDataContractError,
  assertDerivedDataContract,
  contractsForSourceAsset,
  getDerivedDataContract,
  type DerivedDataContract,
} from "./derived-data-contracts";

function base(overrides: Partial<DerivedDataContract> = {}): DerivedDataContract {
  return {
    id: "t",
    sourceAssetId: "data:agent-conversation",
    destination: "derived-index",
    store: "qdrant:test",
    payloadClass: "masked-content",
    transformation: "mask",
    transformDowngradesIdentifiability: true,
    subjectLocatorPath: "messageId",
    sourceDeletePropagation: "queued",
    orphanReconciliation: "source-anti-join",
    reconciliationSloSeconds: 3600,
    ...overrides,
  };
}

describe("derived-data contract invariants (spec §6.4)", () => {
  it("accepts a valid content-bearing contract with propagation + reconciliation", () => {
    expect(() => assertDerivedDataContract(base())).not.toThrow();
  });

  it("rejects a content-bearing copy with no orphan reconciliation", () => {
    expect(() => assertDerivedDataContract(base({ orphanReconciliation: "none" })))
      .toThrow(DerivedDataContractError);
  });

  it("rejects claiming a downgrading transform while still projecting full content", () => {
    expect(() =>
      assertDerivedDataContract(
        base({ payloadClass: "content", transformDowngradesIdentifiability: true }),
      ),
    ).toThrow(/downgrading transform/);
  });

  it("rejects a non-positive reconciliation SLO", () => {
    expect(() => assertDerivedDataContract(base({ reconciliationSloSeconds: 0 }))).toThrow();
  });
});

describe("seeded contracts", () => {
  it("registers the BI-DG-001 semantic-memory projection and validates it", () => {
    const c = getDerivedDataContract("agent-conversation->qdrant-agent-memory");
    expect(c?.store).toBe("qdrant:agent-memory");
    expect(c?.orphanReconciliation).toBe("source-anti-join");
    expect(contractsForSourceAsset("data:agent-conversation").length).toBeGreaterThan(0);
  });

  it("has all seeded contracts passing their invariants", () => {
    for (const c of DERIVED_DATA_CONTRACTS) {
      expect(() => assertDerivedDataContract(c)).not.toThrow();
    }
  });
});
