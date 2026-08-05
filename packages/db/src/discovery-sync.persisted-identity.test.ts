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
// A MANAGED subject by default. These cases are about persisted-vs-payload, not
// about estate scope: a poor source starves enrichment for a UniFi switch just
// as it does for an ARP neighbour. Identity/lifecycle are now asked only of the
// managed estate (BI-A3D12F85), so an `arp:` key would be suppressed before the
// persisted-row logic under test was ever reached — it would assert nothing.
const MANAGED_KEY = "organization:internal:switch:unifi:d0:21:f9:df:56:92";

async function sweepAgainstPersisted(persistedIdentity: {
  manufacturer: string | null;
  observedVersion: string | null;
  normalizedVersion: string | null;
  supportStatus: string;
}, entityKey: string = MANAGED_KEY) {
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
        entityKey,
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
    const key = (suffix: string) => `inventory_entity:${MANAGED_KEY}:${suffix}`;
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
      `inventory_entity:${MANAGED_KEY}:catalog_match_ambiguous`,
    );
  });

  it("asks neither question of an unidentified OBSERVED neighbour", async () => {
    // Same empty row and same empty payload as the case above — only the estate
    // class differs. A randomised-MAC ARP host has no OUI, so it has no vendor,
    // no catalog identity and no support lifecycle by construction; there is no
    // operator action that closes either row. Measured live: 65 of 65 burned-in
    // MACs resolved to a vendor, 0 of 119 randomised ones did. See BI-A3D12F85.
    const { raised, resolvedKeys } = await sweepAgainstPersisted({
      manufacturer: null,
      observedVersion: null,
      normalizedVersion: null,
      supportStatus: "unknown",
    }, "organization:internal:host:arp:192.168.0.42");

    expect(raised).not.toContain("catalog_match_ambiguous");
    expect(raised).not.toContain("lifecycle_unverified");
    // Suppression must CLOSE the already-open rows, not merely stop emitting.
    const key = (suffix: string) =>
      `inventory_entity:organization:internal:host:arp:192.168.0.42:${suffix}`;
    expect(resolvedKeys).toContain(key("catalog_match_ambiguous"));
    expect(resolvedKeys).toContain(key("lifecycle_unverified"));
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

describe("a STALE entity is judged on its persisted identity too", () => {
  // The stale branch built its quality input as {entityKey, entityType,
  // attributionStatus} and nothing else, so identity was absent rather than
  // checked — and `!manufacturer` is true for an omitted field exactly as it is
  // for a missing one. Every stale entity therefore re-raised both types forever,
  // regardless of what the row actually held. Live proof:
  // `database:prom:qdrant:qdrant:6333` carries manufacturer "qdrant" and a known
  // supportStatus and still re-raised on every sweep. This is #3967's principle
  // (judge the persisted row) applied to the normal path only; the stale path had
  // regressed it. Omission is not evidence of absence.
  async function sweepMakingEntityStale(persisted: {
    entityKey: string;
    entityType: string;
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
        discoveryRun: { create: async () => ({ id: "run-stale" }) },
        inventoryEntity: {
          // The row exists and this source previously confirmed it, but THIS
          // sweep's payload is empty — so it goes stale.
          findMany: async () => [persisted],
          upsert: async ({ where }: { where: { entityKey: string } }) => ({
            id: `entity:${where.entityKey}`,
            entityKey: where.entityKey,
          }),
          updateMany: async () => ({ count: 1 }),
        },
        discoveredItem: { create: async () => ({ id: "discovered" }) },
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
        discoveredItems: [],
        inventoryEntities: [],
        inventoryRelationships: [],
        softwareEvidence: [],
      } as never,
      { runKey: "run-stale", sourceSlug: "dpf_bootstrap" },
      {
        projectInventoryEntity: async () => undefined,
        projectInventoryRelationship: async () => undefined,
      },
    );

    return { raised: upserted.map((i) => i.issueType), resolvedKeys };
  }

  it("does not re-raise identity/lifecycle for a stale entity the row identifies", async () => {
    const entityKey = "organization:internal:switch:unifi:d0:21:f9:df:56:92";
    const { raised, resolvedKeys } = await sweepMakingEntityStale({
      entityKey,
      entityType: "switch",
      manufacturer: "Ubiquiti",
      observedVersion: "7.1",
      normalizedVersion: "7.1",
      supportStatus: "supported",
    });

    expect(raised).not.toContain("catalog_match_ambiguous");
    expect(raised).not.toContain("lifecycle_unverified");
    expect(resolvedKeys).toContain(`inventory_entity:${entityKey}:catalog_match_ambiguous`);
    expect(resolvedKeys).toContain(`inventory_entity:${entityKey}:lifecycle_unverified`);
    // Its disappearance IS real signal for managed gear, and still raises.
    expect(raised).toContain("stale_entity");
  });

  it("still raises for a stale entity nothing ever identified", async () => {
    const entityKey = "organization:internal:host:host:linux:196ab12522a9d6ca";
    const { raised } = await sweepMakingEntityStale({
      entityKey,
      entityType: "host",
      manufacturer: null,
      observedVersion: null,
      normalizedVersion: null,
      supportStatus: "unknown",
    });

    expect(raised).toContain("catalog_match_ambiguous");
    expect(raised).toContain("lifecycle_unverified");
  });

  it("honours identity-optional entity types on the stale path", async () => {
    // The stale branch previously hardcoded entityType "inventory_entity", so a
    // stale network_interface — which is identity-OPTIONAL — was judged as if it
    // needed a manufacturer. Carrying the persisted type fixes that too.
    const entityKey = "network_interface:iface:Ethernet_2:192.168.0.200";
    const { raised, resolvedKeys } = await sweepMakingEntityStale({
      entityKey,
      entityType: "network_interface",
      manufacturer: null,
      observedVersion: null,
      normalizedVersion: null,
      supportStatus: "unknown",
    });

    expect(raised).not.toContain("catalog_match_ambiguous");
    expect(resolvedKeys).toContain(`inventory_entity:${entityKey}:catalog_match_ambiguous`);
  });
});
