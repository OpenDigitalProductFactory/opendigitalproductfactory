// packages/db/src/seed-ea-sysml2.ts
// SysML v2 notation seed data.
// Adds one EaNotation ("sysml2"), element types, relationship types, relationship
// rules, DQ stage-gate rules, and a requirement/verification traversal pattern.
//
// SysML v2 is an INTERNAL architecture viewpoint over the existing EA substrate
// (see docs/superpowers/specs/2026-06-14-sysml-architecture-substrate-design.md and
// docs/Reference/sysml-v2.md). It carries the constraint-bearing semantics —
// requirements, constraints, interfaces, allocations, verification, traceability —
// that ArchiMate (structure) and BPMN (process) do not. The DPF EA graph stays
// canonical; SysML adds no new Prisma tables, only seed data on the existing
// EaNotation/EaElementType/EaRelationshipType/EaRelationshipRule/EaDqRule/
// EaTraversalPattern substrate.
//
// Safe to re-run (upsert pattern throughout). Mirrors seed-ea-archimate4.ts.

import { prisma } from "./client.js";
import type { Prisma } from "../generated/client/client";

// ─── Lifecycle constraint sets ────────────────────────────────────────────────
// SysML model elements are logical/design artifacts: they are planned, designed,
// and held in production-of-the-model; they are not built/decommissioned like
// deployed components. Mirror the ArchiMate LOGICAL set.
const LOGICAL_STAGES = ["plan", "design", "production"];
const LOGICAL_STATUSES = ["draft", "active"];

// ─── Element type definitions ──────────────────────────────────────────────────

type ElementTypeDef = {
  slug: string;
  name: string;
  neoLabel: string;
  domain: string;
  description?: string;
  stages: string[];
  statuses: string[];
  ontologyCategory?: string; // structure | behavior | motivation | governance | information
};

// Minimal SysML v2 subset per design spec §10 Phase 1.
const ELEMENT_TYPES: ElementTypeDef[] = [
  // ── Namespace / structure ─────────────────────────────────────────────────
  { slug: "package",              name: "Package",              neoLabel: "Sysml__Package",             domain: "systems", description: "A namespace / model boundary that groups SysML elements.",                                              stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "structure" },
  { slug: "part_definition",      name: "Part Definition",      neoLabel: "Sysml__PartDefinition",      domain: "systems", description: "Definition of a system, subsystem, or component type (a block).",                                       stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "structure" },
  { slug: "part_usage",           name: "Part Usage",           neoLabel: "Sysml__PartUsage",           domain: "systems", description: "A usage/occurrence of a part definition within a containing structure.",                               stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "structure" },
  { slug: "interface_definition", name: "Interface Definition", neoLabel: "Sysml__InterfaceDefinition", domain: "systems", description: "Definition of a contract/connection between ports (an explicit boundary).",                          stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "structure" },
  { slug: "port",                 name: "Port",                 neoLabel: "Sysml__Port",                domain: "systems", description: "A connection/access point on a part through which interactions flow.",                                  stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "structure" },
  // ── Requirement / constraint (motivation) ─────────────────────────────────
  { slug: "requirement",          name: "Requirement",          neoLabel: "Sysml__Requirement",         domain: "systems", description: "A required capability, behaviour, quality, or policy the system must satisfy.",                         stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "motivation" },
  { slug: "constraint",           name: "Constraint",           neoLabel: "Sysml__Constraint",          domain: "systems", description: "A formal restriction/invariant (constraint or parametric) on system values or design choices.",         stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "motivation" },
  // ── Behaviour ─────────────────────────────────────────────────────────────
  { slug: "action",               name: "Action",               neoLabel: "Sysml__Action",              domain: "systems", description: "A system-level behaviour/step. Use BPMN for executable process detail.",                               stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "behavior" },
  { slug: "state",                name: "State",                neoLabel: "Sysml__State",               domain: "systems", description: "A lifecycle or operating mode of a part.",                                                             stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "behavior" },
  // ── Verification / analysis (governance) ──────────────────────────────────
  { slug: "verification_case",    name: "Verification Case",    neoLabel: "Sysml__VerificationCase",    domain: "systems", description: "A check (test, build gate, or evidence record) that proves a requirement or constraint.",               stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "governance" },
  { slug: "analysis_case",        name: "Analysis Case",        neoLabel: "Sysml__AnalysisCase",        domain: "systems", description: "An analysis/trade study evaluating design alternatives against criteria.",                             stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES, ontologyCategory: "behavior" },
];

// ─── Relationship type definitions ────────────────────────────────────────────

type RelTypeDef = {
  slug: string;
  name: string;
  neoType: string;
  description?: string;
};

const REL_TYPES: RelTypeDef[] = [
  { slug: "contains",    name: "Contains",    neoType: "CONTAINS",    description: "Namespace/structural containment (package contains element; part composed of part)." },
  { slug: "specializes", name: "Specializes", neoType: "SPECIALIZES", description: "A definition specializes (inherits from) a more general definition." },
  { slug: "connects",    name: "Connects",    neoType: "CONNECTS",    description: "Ports/parts are connected across an interface." },
  { slug: "allocates",   name: "Allocates",   neoType: "ALLOCATES",   description: "A logical obligation is allocated to a realizing element." },
  { slug: "satisfies",   name: "Satisfies",   neoType: "SATISFIES",   description: "A design element satisfies a requirement." },
  { slug: "verifies",    name: "Verifies",    neoType: "VERIFIES",    description: "A verification case verifies a requirement or constraint." },
  { slug: "refines",     name: "Refines",     neoType: "REFINES",     description: "An element refines (elaborates) a higher-level requirement or element." },
  { slug: "traces",      name: "Traces",      neoType: "TRACES",      description: "General traceability link between model elements or to source artifacts." },
];

// ─── Relationship rules ───────────────────────────────────────────────────────
// Each entry: [fromSlug, toSlug, relSlug]
type RuleDef = [string, string, string];

const RULES: RuleDef[] = [
  // Containment
  ["package", "package", "contains"],
  ["package", "part_definition", "contains"],
  ["package", "requirement", "contains"],
  ["package", "constraint", "contains"],
  ["package", "interface_definition", "contains"],
  ["package", "verification_case", "contains"],
  ["package", "analysis_case", "contains"],
  ["part_definition", "part_usage", "contains"],
  ["part_definition", "port", "contains"],
  ["part_definition", "action", "contains"],
  ["part_definition", "state", "contains"],
  // Specialization
  ["part_definition", "part_definition", "specializes"],
  ["requirement", "requirement", "specializes"],
  ["interface_definition", "interface_definition", "specializes"],
  // Connection
  ["port", "port", "connects"],
  ["part_usage", "part_usage", "connects"],
  ["part_definition", "interface_definition", "connects"],
  // Satisfy / verify / refine / trace
  ["part_definition", "requirement", "satisfies"],
  ["part_usage", "requirement", "satisfies"],
  ["action", "requirement", "satisfies"],
  ["verification_case", "requirement", "verifies"],
  ["verification_case", "constraint", "verifies"],
  ["requirement", "requirement", "refines"],
  ["requirement", "constraint", "refines"],
  ["analysis_case", "requirement", "traces"],
  ["requirement", "requirement", "traces"],
  ["part_definition", "part_definition", "traces"],
  // Allocation (logical obligation → realizing element)
  ["requirement", "part_definition", "allocates"],
  ["action", "part_definition", "allocates"],
];

// ─── DQ stage-gate rules ──────────────────────────────────────────────────────
// Only shapes already proven in seed-ea-archimate4.ts are used here:
//   { requires: { relationshipType, toElementType, minCount } }
//   { requires: { relationshipType, toElementTypeOneOf: [...], minCount } }
//   { requires: { relationshipType, fromElementType, minCount, direction: "inbound" } }

type DqRuleDef = {
  elementTypeSlug: string;
  name: string;
  description: string;
  lifecycleStage: string;
  severity: "error" | "warn";
  rule: Prisma.InputJsonValue;
};

const DQ_RULES: DqRuleDef[] = [
  {
    elementTypeSlug: "verification_case",
    name: "VerificationCase must verify a Requirement or Constraint",
    description: "A verification case must have at least one outbound verifies relationship to a requirement or constraint before design.",
    lifecycleStage: "design",
    severity: "error",
    rule: { requires: { relationshipType: "verifies", toElementTypeOneOf: ["requirement", "constraint"], minCount: 1 } },
  },
  {
    elementTypeSlug: "requirement",
    name: "Requirement should be satisfied by a design element before production",
    description: "A requirement should have at least one inbound satisfies relationship from a part definition before its model reaches production.",
    lifecycleStage: "production",
    severity: "warn",
    rule: { requires: { relationshipType: "satisfies", fromElementType: "part_definition", minCount: 1, direction: "inbound" } },
  },
  {
    elementTypeSlug: "requirement",
    name: "Requirement should have a verification case before production",
    description: "A requirement should be verified by at least one verification case before its model reaches production.",
    lifecycleStage: "production",
    severity: "warn",
    rule: { requires: { relationshipType: "verifies", fromElementType: "verification_case", minCount: 1, direction: "inbound" } },
  },
];

// ─── Traversal patterns ───────────────────────────────────────────────────────

type PatternDef = {
  slug: string;
  name: string;
  description: string;
  patternType: string;
  steps: object[];
  forbiddenShortcuts: string[];
};

const TRAVERSAL_PATTERNS: PatternDef[] = [
  {
    slug: "requirement_satisfaction",
    name: "Requirement Satisfaction and Verification",
    description: "Trace a requirement to the design parts that satisfy it and the verification cases that prove it.",
    patternType: "requirement_satisfaction",
    steps: [
      { elementTypeSlugs: ["requirement"], refinementLevel: null, relationshipTypeSlugs: ["satisfies"], direction: "inbound" },
      { elementTypeSlugs: ["part_definition", "part_usage", "action"], refinementLevel: null, relationshipTypeSlugs: ["allocates"], direction: "outbound" },
      { elementTypeSlugs: ["verification_case"], refinementLevel: "actual", relationshipTypeSlugs: [], direction: "terminal" },
    ],
    forbiddenShortcuts: [
      "A requirement is not proven unless a verification_case (actual refinement) verifies it",
      "satisfies (design intent) is not the same as verifies (evidence of proof)",
      "Do not treat allocates as satisfies — allocation assigns an obligation, satisfaction discharges it",
    ],
  },
];

// ─── Seed function ────────────────────────────────────────────────────────────

export async function seedEaSysml2(): Promise<void> {
  // 1. Upsert notation
  const notation = await prisma.eaNotation.upsert({
    where: { slug: "sysml2" },
    update: { name: "SysML v2", version: "2.0" },
    create: { slug: "sysml2", name: "SysML v2", version: "2.0" },
  });
  console.log(`Seeded EaNotation: ${notation.slug}`);

  // 2. Upsert element types
  const etMap = new Map<string, string>(); // slug → id
  for (const et of ELEMENT_TYPES) {
    const record = await prisma.eaElementType.upsert({
      where: { notationId_slug: { notationId: notation.id, slug: et.slug } },
      update: {
        name: et.name, neoLabel: et.neoLabel, domain: et.domain,
        description: et.description ?? null,
        validLifecycleStages: et.stages, validLifecycleStatuses: et.statuses,
        ontologyCategory: et.ontologyCategory ?? null,
      },
      create: {
        notationId: notation.id, slug: et.slug, name: et.name,
        neoLabel: et.neoLabel, domain: et.domain,
        description: et.description ?? null,
        validLifecycleStages: et.stages, validLifecycleStatuses: et.statuses,
        ontologyCategory: et.ontologyCategory ?? null,
      },
    });
    etMap.set(et.slug, record.id);
  }
  console.log(`Seeded ${ELEMENT_TYPES.length} EaElementTypes (sysml2)`);

  // 3. Upsert relationship types
  const rtMap = new Map<string, string>(); // slug → id
  for (const rt of REL_TYPES) {
    const record = await prisma.eaRelationshipType.upsert({
      where: { notationId_slug: { notationId: notation.id, slug: rt.slug } },
      update: { name: rt.name, neoType: rt.neoType, description: rt.description ?? null },
      create: { notationId: notation.id, slug: rt.slug, name: rt.name, neoType: rt.neoType, description: rt.description ?? null },
    });
    rtMap.set(rt.slug, record.id);
  }
  console.log(`Seeded ${REL_TYPES.length} EaRelationshipTypes (sysml2)`);

  // 4. Upsert relationship rules
  for (const [fromSlug, toSlug, relSlug] of RULES) {
    const fromId = etMap.get(fromSlug);
    const toId = etMap.get(toSlug);
    const relId = rtMap.get(relSlug);
    if (!fromId || !toId || !relId) {
      console.warn(`Skipping sysml2 rule ${fromSlug} -[${relSlug}]-> ${toSlug}: slug not found`);
      continue;
    }
    await prisma.eaRelationshipRule.upsert({
      where: { fromElementTypeId_toElementTypeId_relationshipTypeId: { fromElementTypeId: fromId, toElementTypeId: toId, relationshipTypeId: relId } },
      update: {},
      create: { fromElementTypeId: fromId, toElementTypeId: toId, relationshipTypeId: relId },
    });
  }
  console.log(`Seeded ${RULES.length} EaRelationshipRules (sysml2)`);

  // 5. Upsert DQ rules
  for (const dq of DQ_RULES) {
    const etId = etMap.get(dq.elementTypeSlug);
    if (!etId) {
      console.warn(`Skipping sysml2 DQ rule "${dq.name}": element type "${dq.elementTypeSlug}" not found`);
      continue;
    }
    const existing = await prisma.eaDqRule.findFirst({
      where: { notationId: notation.id, elementTypeId: etId, name: dq.name },
    });
    if (existing) {
      await prisma.eaDqRule.update({
        where: { id: existing.id },
        data: { description: dq.description, lifecycleStage: dq.lifecycleStage, severity: dq.severity, rule: dq.rule },
      });
    } else {
      await prisma.eaDqRule.create({
        data: {
          notationId: notation.id, elementTypeId: etId, name: dq.name,
          description: dq.description, lifecycleStage: dq.lifecycleStage,
          severity: dq.severity, rule: dq.rule,
        },
      });
    }
  }
  console.log(`Seeded ${DQ_RULES.length} EaDqRules (sysml2)`);

  // 6. Traversal patterns
  for (const p of TRAVERSAL_PATTERNS) {
    await prisma.eaTraversalPattern.upsert({
      where: { notationId_slug: { notationId: notation.id, slug: p.slug } },
      update: {
        name: p.name, description: p.description, patternType: p.patternType,
        steps: p.steps, forbiddenShortcuts: p.forbiddenShortcuts,
      },
      create: {
        notationId: notation.id, slug: p.slug, name: p.name, description: p.description,
        patternType: p.patternType, steps: p.steps, forbiddenShortcuts: p.forbiddenShortcuts,
      },
    });
  }
  console.log(`Seeded ${TRAVERSAL_PATTERNS.length} EaTraversalPatterns (sysml2)`);
}
