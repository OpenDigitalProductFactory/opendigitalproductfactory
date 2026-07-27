// packages/db/src/sysml-model-seed.ts
//
// Canonical idempotent applier for SysML projections into the EA graph (Parity Engine).
// ONE implementation shared by both sides of the parity loop:
//   • seed-time, hand-authored current-state views — packages/db/src/seed-ea-sysml-*.ts
//   • runtime auto-extractors — apps/web/lib/ea/*-extract + reconcile-*, which import it
//     through the @dpf/db barrel (re-exported by apps/web/lib/ea/sysml-model-seed.ts).
//
// Lives in packages/db, not apps/web, because seed-time modules cannot import from
// apps/web (the workspace dependency only runs one way) — so the shared seeder has to
// live on the db side for both consumers to reach it.
//
// Generalizes the create/update + soft-remove + relationship + conformance + view
// pattern every projection needs, so each consumer only builds a desired model and
// hands it here instead of re-copying the upsert logic. The db client is INJECTED so
// this is unit-testable without a file-scoped client mock (which can bleed across files
// under the forks pool).
//
// Re-derive-then-apply means a projection cannot drift from its source: a no-delta run
// makes no writes; with `softRemovePrefix` set, elements that disappear from the desired
// set are SOFT-removed (mirrorRemoved=true), never hard-deleted (never-wipe).
//
// Design: docs/superpowers/specs/2026-06-14-design-implementation-parity-engine-design.md

// Extensionless "./client" (not "./client.js") to match the barrel convention in
// index.ts: this module is pulled into the apps/web Next/Turbopack build via the
// @dpf/db barrel + subpath, and Turbopack cannot resolve the ".js" specifier there.
import { prisma } from "./client";
import type { Prisma } from "../generated/client/client";

export interface SysmlDesiredElement {
  /** Stable source key → EaElement.infraCiKey. */
  sysmlKey: string;
  typeSlug: string;
  name: string;
  description: string;
  /** Free-form element properties. A `provenance` value ("deterministic" | "architect")
   *  is preserved if present; otherwise "deterministic" is assumed. */
  properties?: Record<string, unknown>;
}

export interface SysmlDesiredRel {
  fromKey: string;
  toKey: string;
  relSlug: string;
  /** Relationship metadata carried into EaRelationship.properties. Use this for
   * bounded explanation codes, condition labels, and source revisions — never
   * payload content. */
  properties?: Prisma.InputJsonObject;
  /** Relationship types normally resolve inside the model notation. Set this
   * only for an explicitly seeded cross-notation type such as
   * "dpf-cross-notation". */
  relationshipNotationSlug?: string;
}

/** A conformance issue to file against a desired element. Idempotent by element+issueType. */
export interface SysmlDesiredConformanceIssue {
  onKey: string;
  issueType: string;
  severity: string;
  message: string;
}

export interface SysmlDesiredModel {
  elements: SysmlDesiredElement[];
  relationships: SysmlDesiredRel[];
  /** sysml2 element-type slugs used by `elements` (resolved once). */
  elementTypeSlugs: string[];
  /** sysml2 relationship-type slugs used by `relationships` (resolved once). */
  relTypeSlugs: string[];
  view: { name: string; description: string; viewpointName: string; scopeRef: string };
  /** Lifecycle stage stamped on every element (default "production"; design-stage
   *  models such as the AI cockpit pass "design"). */
  lifecycleStage?: string;
  /** Conformance issues this model records (a drift found, or a verification gap). */
  conformanceIssues?: SysmlDesiredConformanceIssue[];
  /** When set, existing elements with this infraCiKey prefix that are NOT in the
   *  desired set are soft-removed (mirrorRemoved=true, lifecycleStatus=inactive). */
  softRemovePrefix?: string;
  /** Cross-LAYER relationships: edges from this model's elements to elements that live
   *  in OTHER projections, resolved against existing `EaElement.infraCiKey` rather than
   *  only this model's in-memory keys. This is the bridge that makes impact analysis
   *  (blast_radius) span layers — e.g. an actual-layer operational/network/integration
   *  occurrence `allocates`/`traces` to the logical part it realizes. Endpoints are
   *  resolved in-model first, then against the live graph; an unresolved endpoint is
   *  logged and counted (never silently dropped) and is linked on a later reconcile once
   *  its projection exists. Same-notation relSlugs must appear in `relTypeSlugs`;
   *  an explicitly named `relationshipNotationSlug` is resolved and rule-validated
   *  dynamically. Ordinary same-projection edges belong in `relationships`, not here. */
  crossLayerRelationships?: SysmlDesiredRel[];
}

export interface SysmlSeedResult {
  status: "applied" | "noop" | "skipped";
  created: number;
  updated: number;
  removed: number;
  /** Cross-layer edges resolved + present this run (see `crossLayerRelationships`). */
  crossLayerLinked?: number;
  /** Cross-layer edges whose endpoint did not resolve to a live element this run. */
  crossLayerUnresolved?: number;
}

export async function applySysmlModel(
  model: SysmlDesiredModel,
  opts: { db?: typeof prisma; notationSlug?: string } = {},
): Promise<SysmlSeedResult> {
  const db = opts.db ?? prisma;
  const notationSlug = opts.notationSlug ?? "sysml2";
  const lifecycleStage = model.lifecycleStage ?? "production";
  const skipped: SysmlSeedResult = { status: "skipped", created: 0, updated: 0, removed: 0 };

  const notation = await db.eaNotation.findUnique({ where: { slug: notationSlug }, select: { id: true } });
  if (!notation) {
    console.warn(`[sysml-model-seed] notation "${notationSlug}" not seeded — skipping`);
    return skipped;
  }
  const notationId = notation.id;

  const etId = new Map<string, string>();
  for (const slug of model.elementTypeSlugs) {
    const et = await db.eaElementType.findUniqueOrThrow({ where: { notationId_slug: { notationId, slug } }, select: { id: true } });
    etId.set(slug, et.id);
  }
  const notationIdBySlug = new Map<string, string>([[notationSlug, notationId]]);
  const rtId = new Map<string, string>();
  const relTypeKey = (relNotationSlug: string, slug: string) => `${relNotationSlug}\u0000${slug}`;
  for (const slug of model.relTypeSlugs) {
    const rt = await db.eaRelationshipType.findUniqueOrThrow({ where: { notationId_slug: { notationId, slug } }, select: { id: true } });
    rtId.set(relTypeKey(notationSlug, slug), rt.id);
  }
  const resolveRelationshipTypeId = async (
    slug: string,
    relNotationSlug = notationSlug,
  ): Promise<string> => {
    const key = relTypeKey(relNotationSlug, slug);
    const cached = rtId.get(key);
    if (cached) return cached;
    let relNotationId = notationIdBySlug.get(relNotationSlug);
    if (!relNotationId) {
      const relNotation = await db.eaNotation.findUnique({
        where: { slug: relNotationSlug },
        select: { id: true },
      });
      if (!relNotation) {
        throw new Error(
          `[sysml-model-seed] relationship notation "${relNotationSlug}" not seeded`,
        );
      }
      relNotationId = relNotation.id;
      notationIdBySlug.set(relNotationSlug, relNotationId);
    }
    const rt = await db.eaRelationshipType.findUniqueOrThrow({
      where: {
        notationId_slug: {
          notationId: relNotationId,
          slug,
        },
      },
      select: { id: true },
    });
    rtId.set(key, rt.id);
    return rt.id;
  };

  // Load existing elements for diff + soft-remove (scoped to the prefix when given).
  const existing: Array<{ id: string; infraCiKey: string | null; properties: unknown }> = model.softRemovePrefix
    ? await db.eaElement.findMany({ where: { infraCiKey: { startsWith: model.softRemovePrefix } }, select: { id: true, infraCiKey: true, properties: true } })
    : [];
  const existingByKey = new Map(existing.map((e) => [e.infraCiKey ?? "", e]));
  const desiredKeys = new Set(model.elements.map((e) => e.sysmlKey));

  let created = 0;
  let updated = 0;
  let removed = 0;
  let crossLayerLinked = 0;
  let crossLayerUnresolved = 0;
  const idByKey = new Map<string, string>();
  const elementTypeIdByKey = new Map<string, string>();
  const staleElementIds: string[] = [];

  for (const el of model.elements) {
    const elementTypeId = etId.get(el.typeSlug);
    if (!elementTypeId) continue;
    const provenance = (el.properties?.provenance as string | undefined) ?? "deterministic";
    const data = {
      elementTypeId,
      name: el.name,
      description: el.description,
      properties: { ...(el.properties ?? {}), provenance, mirrorRemoved: false },
      lifecycleStage,
      lifecycleStatus: "active",
      infraCiKey: el.sysmlKey,
    };
    const prior = existingByKey.get(el.sysmlKey) ?? (await db.eaElement.findFirst({ where: { infraCiKey: el.sysmlKey }, select: { id: true } }));
    if (prior) {
      await db.eaElement.update({ where: { id: prior.id }, data });
      idByKey.set(el.sysmlKey, prior.id);
      elementTypeIdByKey.set(el.sysmlKey, elementTypeId);
      updated++;
    } else {
      const row = await db.eaElement.create({ data, select: { id: true } });
      idByKey.set(el.sysmlKey, row.id);
      elementTypeIdByKey.set(el.sysmlKey, elementTypeId);
      created++;
    }
  }

  const assertExplicitRelationshipRule = async (
    rel: SysmlDesiredRel,
    fromElementTypeId: string,
    toElementTypeId: string,
    relationshipTypeId: string,
  ): Promise<void> => {
    if (!rel.relationshipNotationSlug) return;
    const rule = await db.eaRelationshipRule.findFirst({
      where: {
        fromElementTypeId,
        toElementTypeId,
        relationshipTypeId,
      },
      select: { id: true },
    });
    if (!rule) {
      throw new Error(
        `[sysml-model-seed] relationship rule not seeded for ${rel.fromKey} -[${rel.relationshipNotationSlug}:${rel.relSlug}]-> ${rel.toKey}`,
      );
    }
  };

  if (model.softRemovePrefix) {
    for (const e of existing) {
      if (desiredKeys.has(e.infraCiKey ?? "")) continue;
      const props = (e.properties && typeof e.properties === "object" ? e.properties : {}) as Record<string, unknown>;
      staleElementIds.push(e.id);
      if (props.mirrorRemoved === true) continue;
      await db.eaElement.update({ where: { id: e.id }, data: { lifecycleStatus: "inactive", properties: { ...props, mirrorRemoved: true } } });
      removed++;
    }
  }

  for (const rel of model.relationships) {
    const fromElementId = idByKey.get(rel.fromKey);
    const toElementId = idByKey.get(rel.toKey);
    if (!fromElementId || !toElementId) continue;
    const relNotationSlug = rel.relationshipNotationSlug ?? notationSlug;
    const relationshipTypeId = await resolveRelationshipTypeId(
      rel.relSlug,
      relNotationSlug,
    );
    await assertExplicitRelationshipRule(
      rel,
      elementTypeIdByKey.get(rel.fromKey)!,
      elementTypeIdByKey.get(rel.toKey)!,
      relationshipTypeId,
    );
    const properties: Prisma.InputJsonObject = rel.properties ?? {};
    const found = await db.eaRelationship.findFirst({
      where: { fromElementId, toElementId, relationshipTypeId },
      select: { id: true, properties: true, notationSlug: true },
    });
    if (!found) {
      await db.eaRelationship.create({
        data: {
          fromElementId,
          toElementId,
          relationshipTypeId,
          notationSlug: relNotationSlug,
          properties,
        },
      });
    } else if (
      found.notationSlug !== relNotationSlug ||
      JSON.stringify(found.properties ?? {}) !== JSON.stringify(properties)
    ) {
      await db.eaRelationship.update({
        where: { id: found.id },
        data: { notationSlug: relNotationSlug, properties },
      });
    }
  }

  // Cross-LAYER edges: resolve each endpoint in-model first, then against the live graph
  // by infraCiKey, so a projection can link to elements another projection owns (the
  // bridge that lets blast_radius span layers). A miss is logged + counted, never
  // silently dropped — the next reconcile links it once the target projection exists.
  if (model.crossLayerRelationships?.length) {
    const resolveEndpoint = async (
      key: string,
    ): Promise<{ id: string; elementTypeId: string } | null> => {
      const inModel = idByKey.get(key);
      const inModelType = elementTypeIdByKey.get(key);
      if (inModel && inModelType) {
        return { id: inModel, elementTypeId: inModelType };
      }
      return db.eaElement.findFirst({
        where: { infraCiKey: key },
        select: { id: true, elementTypeId: true },
      });
    };
    for (const rel of model.crossLayerRelationships) {
      const relNotationSlug = rel.relationshipNotationSlug ?? notationSlug;
      const relationshipTypeId = await resolveRelationshipTypeId(
        rel.relSlug,
        relNotationSlug,
      );
      const fromElement = await resolveEndpoint(rel.fromKey);
      const toElement = await resolveEndpoint(rel.toKey);
      if (!fromElement || !toElement) {
        crossLayerUnresolved++;
        console.warn(
          `[sysml-model-seed] cross-layer ${rel.fromKey} -[${rel.relSlug}]-> ${rel.toKey}: ${!fromElement ? "from" : "to"} endpoint unresolved — skipping (links on a later reconcile once its projection exists)`,
        );
        continue;
      }
      const fromElementId = fromElement.id;
      const toElementId = toElement.id;
      await assertExplicitRelationshipRule(
        rel,
        fromElement.elementTypeId,
        toElement.elementTypeId,
        relationshipTypeId,
      );
      const properties: Prisma.InputJsonObject = {
        crossLayer: true,
        ...(rel.properties ?? {}),
      };
      const found = await db.eaRelationship.findFirst({
        where: { fromElementId, toElementId, relationshipTypeId },
        select: { id: true, properties: true, notationSlug: true },
      });
      if (!found) {
        await db.eaRelationship.create({
          data: {
            fromElementId,
            toElementId,
            relationshipTypeId,
            notationSlug: relNotationSlug,
            properties,
          },
        });
      } else if (
        found.notationSlug !== relNotationSlug ||
        JSON.stringify(found.properties ?? {}) !== JSON.stringify(properties)
      ) {
        await db.eaRelationship.update({
          where: { id: found.id },
          data: { notationSlug: relNotationSlug, properties },
        });
      }
      crossLayerLinked++;
    }
  }

  // Conformance issues this model records (idempotent by element + issueType). Only
  // touches the table when the model actually carries issues — so consumers that file
  // none never depend on the eaConformanceIssue delegate.
  if (model.conformanceIssues?.length) {
    for (const ci of model.conformanceIssues) {
      const elId = idByKey.get(ci.onKey);
      if (!elId) continue;
      const found = await db.eaConformanceIssue.findFirst({ where: { elementId: elId, issueType: ci.issueType }, select: { id: true } });
      if (!found) {
        await db.eaConformanceIssue.create({ data: { elementId: elId, issueType: ci.issueType, severity: ci.severity, message: ci.message, status: "open" } });
      }
    }
  }

  const viewpoint = await db.viewpointDefinition.findUnique({ where: { name: model.view.viewpointName }, select: { id: true } });
  const existingView = await db.eaView.findFirst({
    where: { notationId, name: model.view.name },
    select: {
      id: true,
      description: true,
      viewpointId: true,
      scopeRef: true,
    },
  });
  let viewId: string;
  if (!existingView) {
    const createdView = await db.eaView.create({
      data: {
        notationId, name: model.view.name, description: model.view.description,
        layoutType: "graph", scopeType: "custom", scopeRef: model.view.scopeRef,
        viewpointId: viewpoint?.id ?? null, status: "draft",
      },
      select: { id: true },
    });
    viewId = createdView.id;
  } else if (
    existingView.description !== model.view.description ||
    existingView.viewpointId !== (viewpoint?.id ?? null) ||
    existingView.scopeRef !== model.view.scopeRef
  ) {
    await db.eaView.update({
      where: { id: existingView.id },
      data: {
        description: model.view.description,
        viewpointId: viewpoint?.id ?? null,
        scopeRef: model.view.scopeRef,
      },
    });
    viewId = existingView.id;
  } else {
    viewId = existingView.id;
  }
  for (const id of idByKey.values()) {
    await db.eaViewElement.upsert({
      where: { viewId_elementId: { viewId, elementId: id } },
      update: {},
      create: { viewId, elementId: id, mode: "existing" },
    });
  }
  if (staleElementIds.length > 0) {
    await db.eaViewElement.deleteMany({
      where: {
        viewId,
        elementId: { in: staleElementIds },
      },
    });
  }

  const status: SysmlSeedResult["status"] = created === 0 && updated === 0 && removed === 0 ? "noop" : "applied";
  return { status, created, updated, removed, crossLayerLinked, crossLayerUnresolved };
}
