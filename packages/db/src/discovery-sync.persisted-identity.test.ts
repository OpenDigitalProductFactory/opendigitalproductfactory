import { describe, expect, it } from "vitest";

import { persistBootstrapDiscoveryRun } from "./discovery-sync";
import { heapIntegrityRaw } from "../test/discovery-sync-test-support";

// Quality must be evaluated against the PERSISTED row, not this sweep's payload.
//
// `manufacturer` / `supportStatus` are written only when a sweep's enrichment
// produces them, so they are STICKY across sources. `properties` is REPLACED on
// every sweep. A rich source (UniFi, carrying a MAC OUI vendor) therefore
// identifies an entity permanently, while a later poor source (an ARP scan with
// no MAC) starves `deriveInventoryEnrichment` — and evaluating against that
// sweep alone re-raises an identity issue for an entity the row already
// identifies.
//
// Measured on the live install after the previous fix (evaluate against this
// sweep's enrichment) deployed and ran: lifecycle_unverified 166 -> 177,
// catalog_match_ambiguous 196 -> 210. Still climbing. This is why.

type QualityIssue = { issueKey: string; issueType: string };

/** Runs one sweep whose payload carries NO identity signal, against a persisted
 *  row that already holds one. Returns what quality did. */
async function sweepAgainstPersisted(persistedIdentity: {
  manufacturer: string | null;
  observedVersion: string | null;
  normalizedVersion: string | null;
  supportStatus: string;
}) {
  const upserted: QualityIssue[] = [];
  const resolvedKeys: string[] = [];

  const db = {
    $transaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => fn({
      ...heapIntegrityRaw(),
      discoveryRun: { create: async () => ({ id: "run-persisted" }) },
      inventoryEntity: {
        findMany: async () => [],
        // The row already carries identity from an earlier, richer sweep.
        upsert: async ({ where }: { where: { entityKey: string } }) => ({
          id: `entity:${where.entityKey}`,
          entityKey: where.entityKey,
          ...persistedIdentity,
        }),
        updateMany: async () => ({ count: 0 }),
      },
      discoveredItem: {
        create: async ({ data }: { data: { observedKey: string } }) => ({
          id: `discovered:${data.observedKey}`,
        }),
      },
      discoveredSoftwareEvidence: { upsert: async () => ({}) },
      inventoryRelationship: {
        findMany: async () => [],
        upsert: async () => ({ id: "rel", relationshipKey: "rel" }),
        updateMany: async () => ({ count: 0 }),
      },
      discoveredRelationship: { create: async () => ({}) },
      portfolioQualityIssue: {
        findMany: async () => [],
        upsert: async ({ create }: { create: QualityIssue }) => {
          upserted.push({ issueKey: create.issueKey, issueType: create.issueType });
          return {};
        },
        updateMany: async ({ where }: { where: { issueKey?: { in: string[] } } }) => {
          if (where.issueKey?.in) resolvedKeys.push(...where.issueKey.in);
          return { count: where.issueKey?.in?.length ?? 0 };
        },
      },
    }),
  };

  await persistBootstrapDiscoveryRun(
    db as never,
    {
      discoveredItems: [{
        discoveredKey: "dk:arp",
        sourceKind: "arp_scan",
        itemType: "host",
        name: "192.168.0.42",
        externalRef: "dk:arp",
        attributes: {},
      }],
      // Sparse payload: no MAC vendor, no image tag, no name hint, no evidence.
      // This is what an ARP sweep of an already-identified host looks like.
      inventoryEntities: [{
        entityKey: "organization:internal:host:arp:192.168.0.42",
        entityType: "host",
        name: "192.168.0.42",
        discoveredKey: "dk:arp",
        portfolioSlug: "foundational",
        taxonomyNodeId: "foundational/compute/servers",
        attributionStatus: "attributed" as const,
        attributionMethod: "rule" as const,
        attributionConfidence: 0.98,
        providerView: "foundational",
        properties: {},
      }],
      inventoryRelationships: [],
      softwareEvidence: [],
    } as never,
    { runKey: "run-persisted", sourceSlug: "arp_scan" },
    {
      projectInventoryEntity: async () => undefined,
      projectInventoryRelationship: async () => undefined,
    },
  );

  return { raised: upserted.map((i) => i.issueType), resolvedKeys };
}

describe("quality evaluation reads the persisted row, not the sweep payload", () => {
  it("does not re-raise identity/lifecycle for an entity the row already identifies", async () => {
    const { raised, resolvedKeys } = await sweepAgainstPersisted({
      manufacturer: "postgres",
      observedVersion: "16.3",
      normalizedVersion: "16.3",
      supportStatus: "supported",
    });

    expect(raised).not.toContain("catalog_match_ambiguous");
    expect(raised).not.toContain("lifecycle_unverified");

    // And the reconcile reports them closable, so rows opened by earlier sweeps drain.
    const key = (suffix: string) =>
      `inventory_entity:organization:internal:host:arp:192.168.0.42:${suffix}`;
    expect(resolvedKeys).toContain(key("catalog_match_ambiguous"));
    expect(resolvedKeys).toContain(key("lifecycle_unverified"));
  });

  it("still raises for an entity nothing has ever identified", async () => {
    // A genuinely unidentified ARP neighbour: the row is as empty as the sweep.
    // Suppressing this would be a worse bug than the one being fixed.
    const { raised, resolvedKeys } = await sweepAgainstPersisted({
      manufacturer: null,
      observedVersion: null,
      normalizedVersion: null,
      supportStatus: "unknown",
    });

    expect(raised).toContain("catalog_match_ambiguous");
    expect(raised).toContain("lifecycle_unverified");
    expect(resolvedKeys).not.toContain(
      "inventory_entity:organization:internal:host:arp:192.168.0.42:catalog_match_ambiguous",
    );
  });

  it("treats a persisted supportStatus of 'unknown' as unknown, not as a known value", async () => {
    // supportStatus is non-nullable with default "unknown", so a plain ?? chain
    // would stop at the persisted default and never consult the sweep — silently
    // suppressing lifecycle issues for every entity.
    const { raised } = await sweepAgainstPersisted({
      manufacturer: "postgres",
      observedVersion: null,
      normalizedVersion: null,
      supportStatus: "unknown",
    });

    expect(raised).toContain("lifecycle_unverified");
    // Identity is known, so that one must NOT be raised.
    expect(raised).not.toContain("catalog_match_ambiguous");
  });
});
