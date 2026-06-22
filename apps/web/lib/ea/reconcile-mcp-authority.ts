// apps/web/lib/ea/reconcile-mcp-authority.ts
//
// Idempotent reconcile that projects the MCP tool-authority surface into the EA/
// SysML graph (Parity Engine, Slice 1 —
// docs/superpowers/specs/2026-06-14-design-implementation-parity-engine-design.md).
//
// Derives the model from TOOL_TO_GRANTS via buildMcpAuthorityModel (pure), then
// upserts EaElements (by stable infraCiKey `mcp:*`), relationships, and a single
// system-owned view. Re-runnable: a no-delta run makes no writes; tools/grants that
// disappear are SOFT-removed (never hard-deleted — never-wipe). Because the model is
// re-derived from the registry every run, it cannot drift from the implementation.
//
// IO shell over the pure extractor (mirrors run-data-model-mirror.ts). Not run at
// install (304 elements); intended for the scheduled/on-demand reconcile path
// (Slice 1b) like the data-model mirror.

import { prisma } from "@dpf/db";
import { TOOL_TO_GRANTS } from "../tak/agent-grants";
import { buildMcpAuthorityModel, type McpAuthorityModel } from "./mcp-authority-extract";

const NOTATION_SLUG = "sysml2";
const KEY_PREFIX = "mcp:";
const VIEW_NAME = "MCP Tool Authority — Live Projection";

export interface McpAuthorityReconcileResult {
  status: "applied" | "noop" | "skipped";
  created: number;
  updated: number;
  removed: number;
  toolCount: number;
  grantCount: number;
}

export async function reconcileMcpAuthorityModel(
  opts: { toolToGrants?: Record<string, string[]>; db?: typeof prisma } = {},
): Promise<McpAuthorityReconcileResult> {
  // db is injectable so the reconcile is unit-testable WITHOUT a file-scoped
  // vi.mock("@dpf/db") (which can bleed across files under the forks pool).
  const db = opts.db ?? prisma;
  const empty: McpAuthorityReconcileResult = { status: "skipped", created: 0, updated: 0, removed: 0, toolCount: 0, grantCount: 0 };

  const notation = await db.eaNotation.findUnique({ where: { slug: NOTATION_SLUG }, select: { id: true } });
  if (!notation) {
    console.warn(`[mcp-authority] notation "${NOTATION_SLUG}" not seeded — skipping`);
    return empty;
  }
  const notationId = notation.id;

  const etId = new Map<string, string>();
  for (const slug of ["package", "requirement", "action", "constraint"]) {
    const et = await db.eaElementType.findUniqueOrThrow({ where: { notationId_slug: { notationId, slug } }, select: { id: true } });
    etId.set(slug, et.id);
  }
  const rtId = new Map<string, string>();
  for (const slug of ["contains", "traces"]) {
    const rt = await db.eaRelationshipType.findUniqueOrThrow({ where: { notationId_slug: { notationId, slug } }, select: { id: true } });
    rtId.set(slug, rt.id);
  }

  const model: McpAuthorityModel = buildMcpAuthorityModel(opts.toolToGrants ?? TOOL_TO_GRANTS);

  // Load existing mcp:* elements once (for diff + soft-remove).
  const existing: Array<{ id: string; infraCiKey: string | null; properties: unknown }> = await db.eaElement.findMany({
    where: { infraCiKey: { startsWith: KEY_PREFIX } },
    select: { id: true, infraCiKey: true, properties: true },
  });
  const existingByKey = new Map(existing.map((e) => [e.infraCiKey ?? "", e]));
  const desiredKeys = new Set(model.elements.map((e) => e.sysmlKey));

  let created = 0;
  let updated = 0;
  let removed = 0;
  const idByKey = new Map<string, string>();

  // Upsert desired elements.
  for (const el of model.elements) {
    const elementTypeId = etId.get(el.typeSlug);
    if (!elementTypeId) continue;
    const data = {
      elementTypeId,
      name: el.name,
      description: el.description,
      properties: { provenance: "deterministic", sourceKey: "apps/web/lib/tak/agent-grants.ts#TOOL_TO_GRANTS", descriptor: el.descriptor, mirrorRemoved: false },
      lifecycleStage: "production",
      lifecycleStatus: "active",
      infraCiKey: el.sysmlKey,
    };
    const prior = existingByKey.get(el.sysmlKey);
    if (prior) {
      await db.eaElement.update({ where: { id: prior.id }, data });
      idByKey.set(el.sysmlKey, prior.id);
      updated++;
    } else {
      const row = await db.eaElement.create({ data, select: { id: true } });
      idByKey.set(el.sysmlKey, row.id);
      created++;
    }
  }

  // Soft-remove elements that are no longer derived (never hard-delete).
  for (const e of existing) {
    if (desiredKeys.has(e.infraCiKey ?? "")) continue;
    const props = (e.properties && typeof e.properties === "object" ? e.properties : {}) as Record<string, unknown>;
    if (props.mirrorRemoved === true) continue;
    await db.eaElement.update({
      where: { id: e.id },
      data: { lifecycleStatus: "inactive", properties: { ...props, mirrorRemoved: true } },
    });
    removed++;
  }

  // Relationships — upsert on the natural key (from, to, type) so re-runs stay idempotent
  // (atomic; the prior find-then-create raced under concurrent reconciles). BI-8C121D30.
  for (const rel of model.relationships) {
    const fromElementId = idByKey.get(rel.fromKey);
    const toElementId = idByKey.get(rel.toKey);
    const relationshipTypeId = rtId.get(rel.relSlug);
    if (!fromElementId || !toElementId || !relationshipTypeId) continue;
    if (fromElementId === toElementId) continue; // skip self-loops (projection noise)
    await db.eaRelationship.upsert({
      where: { fromElementId_toElementId_relationshipTypeId: { fromElementId, toElementId, relationshipTypeId } },
      create: { fromElementId, toElementId, relationshipTypeId, notationSlug: NOTATION_SLUG, properties: {} },
      update: {},
    });
  }

  // System-owned view.
  const viewpoint = await db.viewpointDefinition.findUnique({ where: { name: "System Decomposition & Interfaces" }, select: { id: true } });
  let view = await db.eaView.findFirst({ where: { notationId, name: VIEW_NAME }, select: { id: true } });
  if (!view) {
    view = await db.eaView.create({
      data: {
        notationId, name: VIEW_NAME,
        description: "Live, system-maintained projection of the MCP tool→grant authorization surface (TOOL_TO_GRANTS).",
        layoutType: "graph", scopeType: "custom", scopeRef: "mcp-tool-authority",
        viewpointId: viewpoint?.id ?? null, status: "draft",
      },
      select: { id: true },
    });
  }
  for (const id of idByKey.values()) {
    await db.eaViewElement.upsert({
      where: { viewId_elementId: { viewId: view.id, elementId: id } },
      update: {},
      create: { viewId: view.id, elementId: id, mode: "existing" },
    });
  }

  const status: McpAuthorityReconcileResult["status"] = created === 0 && updated === 0 && removed === 0 ? "noop" : "applied";
  console.info(`[mcp-authority] reconcile ${status}: created=${created} updated=${updated} removed=${removed} (tools=${model.toolCount}, grants=${model.grantCount})`);
  return { status, created, updated, removed, toolCount: model.toolCount, grantCount: model.grantCount };
}
