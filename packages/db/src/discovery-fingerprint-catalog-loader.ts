/**
 * Load the seed fingerprint catalog (packages/db/data/discovery_fingerprints/)
 * into the database as DiscoveryFingerprintRule rows — the missing bridge
 * between the static catalog and the runtime matcher (spec §8.3).
 *
 * Before this, catalog.json existed and validateFingerprintCatalog gated it,
 * but nothing imported the rules into the DB, so the discovery pipeline never
 * applied them. This loader is invoked from seed.ts AFTER the taxonomy nodes are
 * seeded, so it can resolve each rule's semantic `taxonomyNodeId` (nodeId
 * string, e.g. "foundational/building_management/security_and_surveillance")
 * to the TaxonomyNode cuid the FK requires.
 *
 * Idempotent: upserts on ruleKey, so re-running seed reproduces the same rules
 * with zero SQL (the spec's "re-discovery reproduces them" requirement).
 *
 * NOT barrel-exported (same reason as discovery-fingerprint-catalog): the
 * dynamic catalog path-resolution is flagged by Turbopack's NFT and this is a
 * seed-time (Node) helper. Import directly from this module in seed.ts/tests.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FingerprintMatchExpression, FingerprintRuleInput } from "./discovery-fingerprint-rules";

type CatalogManifest = {
  catalogKey: string;
  version: string;
  schemaVersion: string;
  changelog?: string;
  rules: string[];
};

type CatalogRule = FingerprintRuleInput & {
  status?: string;
  scope?: string;
  source?: string;
  resolvedIdentity?: unknown;
  taxonomyNodeId?: string;
  taxonomy?: { path?: string };
  identityConfidence?: number;
  taxonomyConfidence?: number;
  positiveFixtures?: unknown[];
  negativeFixtures?: unknown[];
};

/** Minimal prisma surface the loader needs — keeps it unit-testable with a mock. */
export type FingerprintCatalogLoaderClient = {
  taxonomyNode: {
    findMany(args: { select: { id: true; nodeId: true } }): Promise<Array<{ id: string; nodeId: string }>>;
  };
  discoveryFingerprintCatalogVersion: {
    upsert(args: unknown): Promise<{ id: string }>;
  };
  discoveryFingerprintRule: {
    upsert(args: unknown): Promise<unknown>;
  };
  catalogIdentity: {
    upsert(args: unknown): Promise<{ id: string }>;
  };
};

export type FingerprintCatalogLoadResult = {
  catalogKey: string;
  version: string;
  loaded: number;
  unresolvedTaxonomy: string[];
  /** How many rules were linked to a canonical CatalogIdentity (BI-0528AD01). */
  catalogIdentitiesLinked: number;
};

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

/** Only string fixture refs are persisted on the rule row; inline fixtures are validation-only. */
function stringFixtureRefs(refs: unknown[] | undefined): string[] {
  return (refs ?? []).filter((ref): ref is string => typeof ref === "string");
}

/**
 * Derive a canonical CatalogIdentity from a rule's inline `resolvedIdentity`
 * (BI-0528AD01 — the bridge to the identity spine landed by #3123). A rule's
 * `resolvedIdentity` is `{ kind, name, vendor }`; the CatalogIdentity is the
 * normalized manufacturer→product row a fingerprint resolves to. Returns null
 * when the identity lacks a product+manufacturer (rule then loads identity-only,
 * catalogIdentityId stays null — same tolerance as an unresolved taxonomy).
 */
export function deriveCatalogIdentity(
  resolvedIdentity: unknown,
): { identityKey: string; part: string; manufacturer: string; product: string } | null {
  if (!resolvedIdentity || typeof resolvedIdentity !== "object") return null;
  const ri = resolvedIdentity as { kind?: unknown; name?: unknown; vendor?: unknown };
  const product = typeof ri.name === "string" ? ri.name.trim() : "";
  const manufacturer = typeof ri.vendor === "string" ? ri.vendor.trim() : "";
  if (!product || !manufacturer) return null;
  // CPE 2.3 part: hardware → h, OS → o, everything else → a (application).
  const part = ri.kind === "hardware" ? "h" : ri.kind === "os" ? "o" : "a";
  const slug = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return { identityKey: `${part}:${slug(manufacturer)}:${slug(product)}`, part, manufacturer, product };
}

/**
 * Resolve the catalog directory. Mirrors the seed's `__dirname/../data/...`
 * convention but also tolerates being run from the repo root.
 */
export function defaultCatalogPath(baseDir: string): string {
  return path.join(baseDir, "..", "data", "discovery_fingerprints", "catalog.json");
}

export async function loadFingerprintCatalogIntoDb(
  db: FingerprintCatalogLoaderClient,
  catalogPath: string,
): Promise<FingerprintCatalogLoadResult> {
  const manifest = await readJson<CatalogManifest>(catalogPath);
  const catalogDir = path.dirname(catalogPath);

  // nodeId (string) → cuid, so rules can reference the semantic path.
  const nodes = await db.taxonomyNode.findMany({ select: { id: true, nodeId: true } });
  const nodeIdToCuid = new Map(nodes.map((n) => [n.nodeId, n.id]));

  const catalogVersion = await db.discoveryFingerprintCatalogVersion.upsert({
    where: { catalogKey_version: { catalogKey: manifest.catalogKey, version: manifest.version } },
    update: { schemaVersion: manifest.schemaVersion, source: "repo" },
    create: {
      catalogKey: manifest.catalogKey,
      version: manifest.version,
      schemaVersion: manifest.schemaVersion,
      source: "repo",
    },
    select: { id: true },
  });

  const unresolvedTaxonomy: string[] = [];
  let loaded = 0;
  let catalogIdentitiesLinked = 0;

  for (const ruleRef of manifest.rules ?? []) {
    const content = await readJson<CatalogRule | CatalogRule[]>(path.join(catalogDir, ruleRef));
    const rules = Array.isArray(content) ? content : [content];

    for (const rule of rules) {
      // Prefer the explicit taxonomyNodeId (nodeId string); fall back to the
      // legacy taxonomy.path. Unresolved → rule still loads as identity-only.
      const nodeIdString = rule.taxonomyNodeId ?? rule.taxonomy?.path ?? null;
      let taxonomyCuid: string | null = null;
      if (nodeIdString) {
        taxonomyCuid = nodeIdToCuid.get(nodeIdString) ?? null;
        if (taxonomyCuid === null) {
          unresolvedTaxonomy.push(`${rule.ruleKey} -> ${nodeIdString}`);
        }
      }

      // Bridge to the canonical identity spine (BI-0528AD01): upsert the
      // CatalogIdentity this rule resolves to and link it. Idempotent on
      // identityKey; null when the rule has no product+manufacturer.
      let catalogIdentityId: string | null = null;
      const identity = deriveCatalogIdentity(rule.resolvedIdentity);
      if (identity) {
        const row = await db.catalogIdentity.upsert({
          where: { identityKey: identity.identityKey },
          update: { part: identity.part, manufacturer: identity.manufacturer, product: identity.product, source: "seeded" },
          create: {
            identityKey: identity.identityKey,
            part: identity.part,
            manufacturer: identity.manufacturer,
            product: identity.product,
            source: "seeded",
            confidence: rule.identityConfidence ?? null,
          },
          select: { id: true },
        });
        catalogIdentityId = row.id;
        catalogIdentitiesLinked += 1;
      }

      const data = {
        catalogVersionId: catalogVersion.id,
        status: rule.status ?? "active",
        scope: rule.scope ?? "global",
        source: rule.source ?? "seed",
        matchExpression: rule.matchExpression as FingerprintMatchExpression,
        requiredEvidenceFamilies: rule.requiredEvidenceFamilies ?? [],
        resolvedIdentity: (rule.resolvedIdentity ?? {}) as object,
        catalogIdentityId,
        taxonomyNodeId: taxonomyCuid,
        identityConfidence: rule.identityConfidence ?? 0,
        taxonomyConfidence: rule.taxonomyConfidence ?? 0,
        fixtureRefs: [...stringFixtureRefs(rule.positiveFixtures), ...stringFixtureRefs(rule.negativeFixtures)],
      };

      await db.discoveryFingerprintRule.upsert({
        where: { ruleKey: rule.ruleKey },
        update: data,
        create: { ruleKey: rule.ruleKey, ...data },
      });
      loaded += 1;
    }
  }

  return {
    catalogKey: manifest.catalogKey,
    version: manifest.version,
    loaded,
    unresolvedTaxonomy,
    catalogIdentitiesLinked,
  };
}
