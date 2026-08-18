// packages/db/src/seed-ea-sysml-data-authority.ts
// SysML v2 current-state view: "Data Authority & Projection" — Phase 2 catch-up
// view (docs/superpowers/specs/2026-06-14-sysml-architecture-substrate-design.md
// §8 view #2), grounded in EP-DATA-ARCH
// (docs/superpowers/specs/2026-06-06-data-architecture-self-maintenance-design.md).
//
// Models DPF's REAL data-authority architecture: one system of record (Postgres,
// defined by the Prisma schema) and three DERIVED, one-way projections — the Neo4j
// graph, the Qdrant vector memory, and the EA data-model mirror — with drift
// surfaced as conformance issues and never written back to the authority.
//
// Each element records `provenance` ("deterministic" = grounded in code/schema with
// a `sourceKey`, vs "architect" = architect-authored judgment). A conformance issue
// is filed for a real drift the current-state survey found (the vestigial
// EaElement/EaRelationship.syncedAt Postgres columns).
//
// Requires the sysml2 notation + viewpoints. Idempotent (elements upsert by
// infraCiKey; relationships/view-elements de-dupe on natural keys). Runtime EA
// validation deferred per the substrate spec.
//
// (Builds a desired model and applies it via the shared applySysmlModel seeder.)

import type { Prisma } from "../generated/client/client";
import { applySysmlModel, type SysmlDesiredElement, type SysmlDesiredModel, type SysmlDesiredRel } from "./sysml-model-seed.js";

const KEY = (suffix: string) => `sysml:data:${suffix}`;

type ElementSeed = {
  key: string;
  typeSlug: string;
  name: string;
  description: string;
  properties?: Prisma.InputJsonValue;
};

const det = (sourceKey: string, extra: Record<string, unknown> = {}) => ({ provenance: "deterministic", sourceKey, ...extra });
const arch = (extra: Record<string, unknown> = {}) => ({ provenance: "architect", ...extra });

// ── Parts (entities) → realizing substrate ──────────────────────────────────
const PARTS: Array<ElementSeed & { satisfies: string[] }> = [
  { key: "part:postgres",   typeSlug: "part_definition", name: "Postgres (System of Record)", description: "The single authority for all entities; every application/seed write lands here first. Authority is a design contract (one-way projection writers), not a DB-level guard.", properties: arch({ sourceKey: "packages/db/src/graph-sync.ts#L2-4 (\"Postgres is always the authority\")" }), satisfies: [] },
  { key: "part:prisma",     typeSlug: "part_definition", name: "Prisma Schema (canonical definitions)", description: "prisma/schema domain folder — the source-of-truth structural definition of the authority; read by the mirror via schema-source.ts.", properties: det("packages/db/prisma/schema/main.prisma; packages/db/src/schema-source.ts"), satisfies: [] },
  { key: "part:neo4j",      typeSlug: "part_definition", name: "Neo4j Projection (graph)", description: "Derived graph projection of the EA graph, infra/IT4IT topology, and document references. Fire-and-forget MERGE writes that never throw — a projection outage cannot block a Postgres write.", properties: det("packages/db/src/graph-sync.ts"), satisfies: ["req:REQ-DATA-1"] },
  { key: "part:qdrant",     typeSlug: "part_definition", name: "Qdrant Projection (vector memory)", description: "Derived vector projection for semantic recall: four 768-dim Cosine collections (agent-memory, platform-knowledge, wiki-pages, documents). Recall reads it for relevance; Postgres stays authoritative (e.g. commandments return even when Qdrant is down).", properties: det("packages/db/src/qdrant.ts; apps/web/lib/inference/embedding.ts"), satisfies: ["req:REQ-DATA-1"] },
  { key: "part:mirror",     typeSlug: "part_definition", name: "Data-Model Mirror / Reconciler", description: "Deterministic, idempotent Prisma→EA projection: parse schema → pure diff (planMirror) → apply (reconcileDataModelMirror) → best-effort Neo4j sync. EP-DATA-ARCH.", properties: det("apps/web/lib/ea/data-model-mirror.ts; apps/web/lib/ea/data-model-mirror-apply.ts; apps/web/lib/ea/run-data-model-mirror.ts"), satisfies: ["req:REQ-DATA-2", "req:REQ-DATA-4", "req:REQ-DATA-5"] },
  { key: "part:dataobject", typeSlug: "part_definition", name: "DataObject Mirror Nodes", description: "The mirror's output in the EA substrate: one data_object EaElement per Prisma model + one associated_with EaRelationship per relation, each carrying a stable source key.", properties: det("packages/db/prisma/schema/ea-architecture.prisma#EaElement; apps/web/lib/ea/data-model-mirror.ts#sourceKey"), satisfies: ["req:REQ-DATA-3"] },
  { key: "part:dataview",   typeSlug: "part_definition", name: "\"Data Model\" EaView (system-owned)", description: "The single system-owned projection container: EaView scopeType=data-model, scopeRef=prisma, with its Data Model ViewpointDefinition; membership maintained by the mirror.", properties: det("apps/web/lib/ea/data-model-mirror-apply.ts#ensureDataModelView"), satisfies: ["req:REQ-DATA-6"] },
  { key: "part:conformance", typeSlug: "part_definition", name: "Conformance-Issue Store (drift surface)", description: "EaConformanceIssue — the durable drift ledger (issueType, severity, status, detailsJson.issueKey for idempotent upsert). Where mirror + steward findings land.", properties: det("packages/db/prisma/schema/ea-architecture.prisma#EaConformanceIssue"), satisfies: ["req:REQ-DATA-2"] },
  { key: "part:steward",    typeSlug: "part_definition", name: "Data-Architecture Steward", description: "Deterministic drift detector (fk-without-index, missing-inverse-relation, orphan-model, ignored-model). Writes issues, never mutates the mirror; self-resolves fixed drift.", properties: det("apps/web/lib/ea/data-architecture-steward.ts; apps/web/lib/ea/data-architecture-steward-apply.ts"), satisfies: ["req:REQ-DATA-2"] },
];

// ── Requirements (invariants) ───────────────────────────────────────────────
const REQUIREMENTS: ElementSeed[] = [
  { key: "req:REQ-DATA-1", typeSlug: "requirement", name: "REQ-DATA-1 Projections are derived, never authoritative", description: "No projection (Neo4j, Qdrant, EA mirror) writes back to Postgres. Projection writers are one-way and fail-soft (log, never throw); recall always treats Postgres as authority.", properties: arch({ note: "design contract (one-way writers), not a DB constraint", sourceKey: "packages/db/src/graph-sync.ts#L2-4; apps/web/lib/inference/embedding.ts" }) },
  { key: "req:REQ-DATA-2", typeSlug: "requirement", name: "REQ-DATA-2 Drift surfaces as a conformance issue, never a silent overwrite", description: "On a duplicate source key the mirror plan is blocked and writes a mirror-duplicate-source-key issue (severity error) WITHOUT writing; steward drift findings are written as issues, not applied as mutations.", properties: det("apps/web/lib/ea/data-model-mirror-apply.ts#writeDuplicateIssues; apps/web/lib/ea/data-architecture-steward.ts") },
  { key: "req:REQ-DATA-3", typeSlug: "requirement", name: "REQ-DATA-3 Every mirrored node carries a stable source key", description: "Element key prisma:model:<Model>; relationship key prisma:relation:<From>:<field>:<To>. Stored in properties.sourceKey and the infraCiKey column, denormalized onto the Neo4j node.", properties: det("apps/web/lib/ea/data-model-mirror.ts#L23-37; apps/web/lib/ea/data-model-mirror-apply.ts#L210") },
  { key: "req:REQ-DATA-4", typeSlug: "requirement", name: "REQ-DATA-4 Mirror is deterministic and idempotent", description: "A no-delta run performs no writes and no snapshot (status noop); the nightly task runs the reconcile directly without an LLM loop.", properties: det("apps/web/lib/ea/data-model-mirror-apply.ts; apps/web/lib/actions/agent-task-scheduler.ts#L200-205") },
  { key: "req:REQ-DATA-5", typeSlug: "requirement", name: "REQ-DATA-5 Mirror removals are soft, never hard deletes", description: "Disappeared models/relations are flagged properties.mirrorRemoved=true; never hard-deleted (aligns with the never-wipe-db-for-code-fixes commandment).", properties: det("apps/web/lib/ea/data-model-mirror-apply.ts#L349-362") },
  { key: "req:REQ-DATA-6", typeSlug: "requirement", name: "REQ-DATA-6 The Data Model view is system-owned and singular", description: "Exactly one EaView with scopeType=data-model, scopeRef=prisma; ensureDataModelView finds-or-creates, never duplicates.", properties: det("apps/web/lib/ea/data-model-mirror-apply.ts#ensureDataModelView") },
];

// ── Constraint ───────────────────────────────────────────────────────────────
const CONSTRAINTS: ElementSeed[] = [
  { key: "con:CON-DATA-1", typeSlug: "constraint", name: "CON-DATA-1 One-way authority→projection", description: "dataflow(Postgres) → {Neo4j, Qdrant, EA mirror} only; ∄ edge projection→Postgres. Projection failure ⇒ degrade, never block the authority write.", properties: det("packages/db/src/graph-sync.ts", { kind: "parametric" }) },
];

// ── Verification cases (evidence records) ────────────────────────────────────
const VERIFICATIONS: Array<ElementSeed & { verifies: string[] }> = [
  { key: "vc:VC-DATA-CONFORMANCE", typeSlug: "verification_case", name: "VC-DATA-CONFORMANCE drift ledger", description: "EaConformanceIssue rows are the durable drift evidence; idempotent upsert by detailsJson.issueKey; fixed drift auto-resolves.", properties: det("apps/web/lib/ea/data-architecture-steward-apply.ts#L40-108", { status: "active" }), verifies: ["req:REQ-DATA-2"] },
  { key: "vc:VC-DATA-SNAPSHOT", typeSlug: "verification_case", name: "VC-DATA-SNAPSHOT evolution history", description: "EaSnapshot written only on material mirror delta, with elementCount/relationshipCount/changeSummary/graphJson — proves change is recorded and no-op runs write nothing.", properties: det("apps/web/lib/ea/data-model-mirror-apply.ts#L310-326", { status: "active" }), verifies: ["req:REQ-DATA-4"] },
  { key: "vc:VC-DATA-DUPGUARD", typeSlug: "verification_case", name: "VC-DATA-DUPGUARD duplicate-source-key halt", description: "On duplicate source key the applier writes a mirror-duplicate-source-key issue and stops without writing — proves source-key integrity is enforced before mutation.", properties: det("apps/web/lib/ea/data-model-mirror-apply.ts#writeDuplicateIssues", { status: "active" }), verifies: ["req:REQ-DATA-3"] },
  { key: "vc:VC-DATA-SCHEDULE", typeSlug: "verification_case", name: "VC-DATA-SCHEDULE nightly reconcile run", description: "ScheduledAgentTask data-model-mirror-nightly (0 3 * * * UTC) runs the deterministic reconcile; lastRunAt/lastStatus/lastError are the run-audit evidence.", properties: det("packages/db/src/data-model-mirror-config.ts; apps/web/lib/actions/agent-task-scheduler.ts#L212-229", { status: "active" }), verifies: ["req:REQ-DATA-4"] },
  { key: "vc:VC-DATA-SOFTREMOVE", typeSlug: "verification_case", name: "VC-DATA-SOFTREMOVE soft-remove flag", description: "Removed models/relations are flagged mirrorRemoved=true rather than deleted — proves the never-wipe removal semantics.", properties: det("apps/web/lib/ea/data-model-mirror-apply.ts#L349-362", { status: "active" }), verifies: ["req:REQ-DATA-5"] },
];

// CON-DATA-1 refines the derived-projection requirement.
const CONSTRAINT_REFINES: Array<{ from: string; to: string }> = [
  { from: "con:CON-DATA-1", to: "req:REQ-DATA-1" },
];

// Authority → projection topology (connects), and mirror data path.
const CONNECTS: Array<{ from: string; to: string }> = [
  { from: "part:postgres", to: "part:neo4j" },
  { from: "part:postgres", to: "part:qdrant" },
  { from: "part:prisma", to: "part:mirror" },
  { from: "part:mirror", to: "part:dataobject" },
  { from: "part:dataobject", to: "part:dataview" },
  { from: "part:mirror", to: "part:conformance" },
  { from: "part:steward", to: "part:conformance" },
];

// A real drift the current-state survey found, filed as a conformance issue on the
// Neo4j projection part (the live "last projected" signal is the Neo4j node property;
// the Postgres EaElement/EaRelationship.syncedAt columns are unwritten).
const CONFORMANCE: Array<{ onKey: string; issueType: string; severity: string; message: string }> = [
  {
    onKey: "part:neo4j",
    issueType: "projection-freshness-signal-split",
    severity: "info",
    message: "EaElement.syncedAt / EaRelationship.syncedAt Postgres columns are not written by the mirror; the authoritative 'last projected at' signal is the Neo4j node/edge syncedAt property. Reconcile or deprecate the vestigial Postgres columns.",
  },
];

const PACKAGE: ElementSeed = {
  key: "pkg",
  typeSlug: "package",
  name: "Data Authority & Projection",
  description: "SysML v2 current-state view of DPF data authority: one system of record (Postgres, defined by Prisma) and three derived one-way projections (Neo4j graph, Qdrant vectors, EA data-model mirror), with drift surfaced as conformance issues, never written back.",
  properties: arch({ sysmlPackage: "PKG-DATA", catchUpView: "Data Authority and Projection Model (spec §8 #2)", grounding: "EP-DATA-ARCH 2026-06-06" }),
};

const VIEW_NAME = "Data Authority & Projection — Current State";

function buildDataAuthorityModel(): SysmlDesiredModel {
  const all: ElementSeed[] = [PACKAGE, ...REQUIREMENTS, ...CONSTRAINTS, ...PARTS, ...VERIFICATIONS];
  const elements: SysmlDesiredElement[] = all.map((seed) => ({
    sysmlKey: KEY(seed.key),
    typeSlug: seed.typeSlug,
    name: seed.name,
    description: seed.description,
    properties: (seed.properties ?? {}) as Record<string, unknown>,
  }));

  const relationships: SysmlDesiredRel[] = [];
  for (const seed of all) {
    if (seed.key !== PACKAGE.key) relationships.push({ fromKey: KEY(PACKAGE.key), toKey: KEY(seed.key), relSlug: "contains" });
  }
  for (const p of PARTS) for (const reqKey of p.satisfies) relationships.push({ fromKey: KEY(p.key), toKey: KEY(reqKey), relSlug: "satisfies" });
  for (const v of VERIFICATIONS) for (const reqKey of v.verifies) relationships.push({ fromKey: KEY(v.key), toKey: KEY(reqKey), relSlug: "verifies" });
  for (const ref of CONSTRAINT_REFINES) relationships.push({ fromKey: KEY(ref.from), toKey: KEY(ref.to), relSlug: "refines" });
  for (const c of CONNECTS) relationships.push({ fromKey: KEY(c.from), toKey: KEY(c.to), relSlug: "connects" });

  return {
    elements,
    relationships,
    elementTypeSlugs: ["package", "requirement", "constraint", "part_definition", "verification_case"],
    relTypeSlugs: ["contains", "satisfies", "verifies", "refines", "connects"],
    view: {
      name: VIEW_NAME,
      description: "Current-state data-authority model: the authority, its three derived projections, the invariants they satisfy, and the records that verify them.",
      viewpointName: "Systems Requirements & Verification",
      scopeRef: "data-authority",
    },
    conformanceIssues: CONFORMANCE.map((ci) => ({ onKey: KEY(ci.onKey), issueType: ci.issueType, severity: ci.severity, message: ci.message })),
  };
}

export async function seedEaSysmlDataAuthority(): Promise<void> {
  const model = buildDataAuthorityModel();
  const r = await applySysmlModel(model);
  if (r.status !== "skipped") {
    console.log(`Seeded Data Authority SysML view: ${model.elements.length} elements + view "${VIEW_NAME}"`);
  }
}
