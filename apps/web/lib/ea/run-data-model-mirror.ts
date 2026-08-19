// Data-model mirror runtime — EP-DATA-ARCH Phase 6 (BI-8E274CD3).
//
// Composes the merged, tested pieces into one executable the triggers call
// (on-demand server action, nightly scheduled task): read the canonical Prisma
// schema → parse (Phase 1) → reconcile into EA (Phase 2) → steward drift pass
// (Phase 4) → best-effort Neo4j projection. Postgres is the source of truth the
// /ea/data-model view renders from; the Neo4j sync is an optimization and never
// fails the run.

import { prisma as defaultPrisma, readCanonicalPrismaSchema, syncEaElement, syncEaRelationship } from "@dpf/db";

import { parsePrismaSchema } from "../build/code-graph/extractors/prisma-schema-adapter";
import { reconcileDataModelMirror, type MirrorPrismaClient, type MirrorResult } from "./data-model-mirror-apply";
import { runDataArchitectureSteward, type StewardPrismaClient, type StewardResult } from "./data-architecture-steward-apply";

export type DataModelMirrorRunResult = {
  mirror: MirrorResult;
  steward: StewardResult;
  neo4jSynced: number | null;
};

type RunDeps = {
  /** Defaults to the real prisma client. */
  prisma?: unknown;
  /** Defaults to the canonical schema bundled with @dpf/db. */
  schemaSource?: string;
  /** Best-effort Neo4j projection of the mirrored elements (default true). */
  syncNeo4j?: boolean;
  createdById?: string | null;
};

/** Run a full data-architecture mirror + steward pass and return a combined result. */
export async function runDataModelMirror(deps: RunDeps = {}): Promise<DataModelMirrorRunResult> {
  const prisma = (deps.prisma ?? defaultPrisma) as unknown;
  const source = deps.schemaSource ?? readCanonicalPrismaSchema();
  const facts = parsePrismaSchema(source);

  const mirror = await reconcileDataModelMirror({
    prisma: prisma as MirrorPrismaClient,
    facts,
    createdById: deps.createdById ?? null,
  });

  const steward = await runDataArchitectureSteward({
    prisma: prisma as StewardPrismaClient,
    facts,
  });

  let neo4jSynced: number | null = null;
  if (deps.syncNeo4j !== false && mirror.status !== "blocked") {
    neo4jSynced = await projectMirrorToNeo4j(prisma).catch(() => null);
  }

  return { mirror, steward, neo4jSynced };
}

// Best-effort: sync the data-model view's mirrored elements + relationships into
// Neo4j so the EA graph renderer reflects them. Never throws.
async function projectMirrorToNeo4j(prisma: unknown): Promise<number> {
  const client = prisma as {
    eaView: { findFirst(args: unknown): Promise<{ id: string } | null> };
    eaViewElement: { findMany(args: unknown): Promise<Array<{ element: EaElementForSync }>> };
    eaRelationship: { findMany(args: unknown): Promise<Array<EaRelationshipForSync>> };
  };

  const view = await client.eaView.findFirst({ where: { scopeType: "data-model", scopeRef: "prisma" } });
  if (!view) return 0;

  const members = await client.eaViewElement.findMany({
    where: { viewId: view.id },
    select: {
      element: {
        select: {
          id: true,
          name: true,
          lifecycleStage: true,
          lifecycleStatus: true,
          infraCiKey: true,
          digitalProductId: true,
          taxonomyNodeId: true,
          portfolio: { select: { slug: true } },
          elementType: { select: { neoLabel: true, slug: true, notation: { select: { slug: true } } } },
        },
      },
    },
  });

  let count = 0;
  for (const { element: el } of members) {
    await syncEaElement({
      id: el.id,
      neoLabel: el.elementType.neoLabel,
      notationSlug: el.elementType.notation.slug,
      elementTypeSlug: el.elementType.slug,
      name: el.name,
      lifecycleStage: el.lifecycleStage,
      lifecycleStatus: el.lifecycleStatus,
      infraCiKey: el.infraCiKey,
      digitalProductId: el.digitalProductId,
      portfolioSlug: el.portfolio?.slug ?? null,
      taxonomyNodeId: el.taxonomyNodeId,
    });
    count += 1;
  }

  const relationships = await client.eaRelationship.findMany({
    where: { properties: { path: ["sourceKey"], string_starts_with: "prisma:relation:" } },
    select: {
      id: true,
      fromElementId: true,
      toElementId: true,
      notationSlug: true,
      relationshipType: { select: { neoType: true, slug: true } },
    },
  });
  for (const rel of relationships) {
    await syncEaRelationship({
      id: rel.id,
      fromElementId: rel.fromElementId,
      toElementId: rel.toElementId,
      neoType: rel.relationshipType.neoType,
      notationSlug: rel.notationSlug,
      relationshipTypeSlug: rel.relationshipType.slug,
    });
  }

  return count;
}

type EaElementForSync = {
  id: string;
  name: string;
  lifecycleStage: string;
  lifecycleStatus: string;
  infraCiKey: string | null;
  digitalProductId: string | null;
  taxonomyNodeId: string | null;
  portfolio: { slug: string } | null;
  elementType: { neoLabel: string; slug: string; notation: { slug: string } };
};

type EaRelationshipForSync = {
  id: string;
  fromElementId: string;
  toElementId: string;
  notationSlug: string;
  relationshipType: { neoType: string; slug: string };
};
