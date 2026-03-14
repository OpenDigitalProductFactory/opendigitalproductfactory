// packages/db/src/seed-ea-archimate4.ts
// ArchiMate 4 notation seed data.
// Adds one EaNotation, element types, relationship types, relationship rules, and DQ stage-gate rules.
// Safe to re-run (upsert pattern throughout).

import { prisma } from "./client.js";
import type { Prisma } from "../generated/client";

// ─── Lifecycle constraint sets ────────────────────────────────────────────────

// Logical entities: cannot be decommissioned; "inactive" and "retirement" don't apply
const LOGICAL_STAGES   = ["plan", "design", "production"];
const LOGICAL_STATUSES = ["draft", "active"];

// Full lifecycle for operational / manifested elements
const FULL_STAGES   = ["plan", "design", "build", "production", "retirement"];
const FULL_STATUSES = ["draft", "active", "inactive"];

// ─── Element type definitions ──────────────────────────────────────────────────
// Representative subset: 30 of 42 ArchiMate 4 element types are seeded here.
// The full catalog (additional common-layer types: process, function, interaction, event,
// application service variants) is deferred to Phase EA-2 seed expansion.

type ElementTypeDef = {
  slug: string;
  name: string;
  neoLabel: string;
  domain: string;
  description?: string;
  stages: string[];
  statuses: string[];
};

const ELEMENT_TYPES: ElementTypeDef[] = [
  // Strategy
  { slug: "value_stream",        name: "Value Stream",        neoLabel: "ArchiMate__ValueStream",      domain: "strategy",        description: "A sequence of activities creating overall value for a customer or stakeholder",  stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES },
  { slug: "value_stream_stage",  name: "Value Stream Stage",  neoLabel: "ArchiMate__ValueStreamStage", domain: "strategy",        description: "An ordered stage within a value stream",                                            stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES },
  { slug: "capability",          name: "Capability",          neoLabel: "ArchiMate__Capability",       domain: "strategy",        description: "An ability of an active structure element",                                      stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES },
  { slug: "course_of_action",    name: "Course of Action",    neoLabel: "ArchiMate__CourseOfAction",   domain: "strategy",        description: "An approach or plan for configuring capabilities",                               stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES },
  // Business
  { slug: "business_capability", name: "Business Capability", neoLabel: "ArchiMate__BusinessCapability", domain: "business",      description: "A particular ability that a business possesses",                                 stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES },
  { slug: "business_actor",      name: "Business Actor",      neoLabel: "ArchiMate__BusinessActor",    domain: "business",        description: "An organizational entity capable of performing behaviour",                       stages: FULL_STAGES,    statuses: FULL_STATUSES },
  { slug: "business_role",       name: "Business Role",       neoLabel: "ArchiMate__BusinessRole",     domain: "business",        description: "The responsibility of performing a business behaviour",                          stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES },
  { slug: "business_object",     name: "Business Object",     neoLabel: "ArchiMate__BusinessObject",   domain: "business",        description: "A concept used within a business domain",                                       stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES },
  { slug: "contract",            name: "Contract",            neoLabel: "ArchiMate__Contract",         domain: "business",        description: "A formal or informal agreement between parties",                                 stages: FULL_STAGES,    statuses: FULL_STATUSES },
  // Application
  { slug: "application_component", name: "Application Component", neoLabel: "ArchiMate__ApplicationComponent", domain: "application", description: "An encapsulation of application functionality aligned to implementation structure", stages: FULL_STAGES, statuses: FULL_STATUSES },
  { slug: "application_service", name: "Application Service", neoLabel: "ArchiMate__ApplicationService", domain: "application",   description: "An explicitly defined exposed application behaviour",                            stages: FULL_STAGES,    statuses: FULL_STATUSES },
  { slug: "data_object",         name: "Data Object",         neoLabel: "ArchiMate__DataObject",       domain: "application",     description: "Data structured for automated processing",                                       stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES },
  // Technology
  { slug: "technology_node",     name: "Technology Node",     neoLabel: "ArchiMate__TechnologyNode",   domain: "technology",      description: "A computational or physical resource hosting artefacts",                         stages: FULL_STAGES,    statuses: FULL_STATUSES },
  { slug: "technology_service",  name: "Technology Service",  neoLabel: "ArchiMate__TechnologyService", domain: "technology",     description: "An explicitly defined exposed technology behaviour",                             stages: FULL_STAGES,    statuses: FULL_STATUSES },
  { slug: "artifact",            name: "Artifact",            neoLabel: "ArchiMate__Artifact",         domain: "technology",      description: "A piece of data used or produced by a technology node",                          stages: FULL_STAGES,    statuses: FULL_STATUSES },
  { slug: "device",              name: "Device",              neoLabel: "ArchiMate__Device",           domain: "technology",      description: "A physical IT resource",                                                         stages: FULL_STAGES,    statuses: FULL_STATUSES },
  { slug: "system_software",     name: "System Software",     neoLabel: "ArchiMate__SystemSoftware",   domain: "technology",      description: "Software that provides a platform on which applications run",                    stages: FULL_STAGES,    statuses: FULL_STATUSES },
  { slug: "communication_network", name: "Communication Network", neoLabel: "ArchiMate__CommunicationNetwork", domain: "technology", description: "A set of structures that connects technology nodes",                       stages: FULL_STAGES,    statuses: FULL_STATUSES },
  // Motivation
  { slug: "stakeholder",         name: "Stakeholder",         neoLabel: "ArchiMate__Stakeholder",      domain: "motivation",      description: "A role of an individual, team, or organisation that has interests in the architecture", stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES },
  { slug: "driver",              name: "Driver",              neoLabel: "ArchiMate__Driver",           domain: "motivation",      description: "An external or internal condition motivating change",                            stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES },
  { slug: "goal",                name: "Goal",                neoLabel: "ArchiMate__Goal",             domain: "motivation",      description: "A high-level statement of intent, direction, or desired end state",               stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES },
  { slug: "outcome",             name: "Outcome",             neoLabel: "ArchiMate__Outcome",          domain: "motivation",      description: "An end result that has been achieved",                                           stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES },
  { slug: "principle",           name: "Principle",           neoLabel: "ArchiMate__Principle",        domain: "motivation",      description: "A qualitative statement of intent guiding design",                               stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES },
  { slug: "requirement",         name: "Requirement",         neoLabel: "ArchiMate__Requirement",      domain: "motivation",      description: "A statement of need that must be realised by an architecture",                   stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES },
  { slug: "constraint",          name: "Constraint",          neoLabel: "ArchiMate__Constraint",       domain: "motivation",      description: "A restriction on the way in which a system is realised",                         stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES },
  // Common (notation-agnostic behaviour / structure elements)
  { slug: "resource",            name: "Resource",            neoLabel: "ArchiMate__Resource",         domain: "common",          description: "An asset owned by an actor",                                                     stages: FULL_STAGES,    statuses: FULL_STATUSES },
  { slug: "object",              name: "Object",              neoLabel: "ArchiMate__Object",           domain: "common",          description: "A passive element on which behaviour can be performed",                          stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES },
  // Implementation & Migration
  { slug: "work_package",        name: "Work Package",        neoLabel: "ArchiMate__WorkPackage",      domain: "impl_migration",  description: "A series of actions to achieve a goal or produce deliverables",                  stages: FULL_STAGES,    statuses: FULL_STATUSES },
  { slug: "deliverable",         name: "Deliverable",         neoLabel: "ArchiMate__Deliverable",      domain: "impl_migration",  description: "A precisely defined result of work",                                             stages: FULL_STAGES,    statuses: FULL_STATUSES },
  { slug: "plateau",             name: "Plateau",             neoLabel: "ArchiMate__Plateau",          domain: "impl_migration",  description: "A relatively stable state of the architecture",                                  stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES },
  { slug: "gap",                 name: "Gap",                 neoLabel: "ArchiMate__Gap",              domain: "impl_migration",  description: "A difference between two states of the architecture",                            stages: LOGICAL_STAGES, statuses: LOGICAL_STATUSES },
];

// ─── Relationship type definitions ────────────────────────────────────────────

type RelTypeDef = {
  slug: string;
  name: string;
  neoType: string;
  description?: string;
};

const REL_TYPES: RelTypeDef[] = [
  { slug: "realizes",         name: "Realizes",         neoType: "REALIZES",        description: "Lower-layer element realises a higher-layer concept" },
  { slug: "depends_on",       name: "Depends On",       neoType: "DEPENDS_ON",      description: "Runtime or structural dependency" },
  { slug: "assigned_to",      name: "Assigned To",      neoType: "ASSIGNED_TO",     description: "Active structure element assigned to a behaviour or resource" },
  { slug: "composed_of",      name: "Composed Of",      neoType: "COMPOSED_OF",     description: "Whole-part structural composition" },
  { slug: "associated_with",  name: "Associated With",  neoType: "ASSOCIATED_WITH", description: "Generic unspecified relationship" },
  { slug: "influences",       name: "Influences",       neoType: "INFLUENCES",      description: "Motivation element influences another element" },
  { slug: "triggers",         name: "Triggers",         neoType: "TRIGGERS",        description: "Temporal or causal trigger between behaviours" },
  { slug: "flows_to",         name: "Flows To",         neoType: "FLOWS_TO",        description: "Information or material flow" },
  { slug: "serves",           name: "Serves",           neoType: "SERVES",          description: "An element provides services to another element" },
  { slug: "accesses",         name: "Accesses",         neoType: "ACCESSES",        description: "An active element accesses a passive element" },
];

// ─── Relationship rules ───────────────────────────────────────────────────────
// Each entry: [fromSlug, toSlug, relSlug]
// Rule uniqueness is guaranteed per notation because EaElementType IDs are notation-scoped.

type RuleDef = [string, string, string];

const RULES: RuleDef[] = [
  // Application → Business
  ["application_component", "business_capability",   "realizes"],
  ["application_service",   "business_capability",   "realizes"],
  ["application_component", "business_capability",   "associated_with"],
  // Application → Technology
  ["application_component", "technology_node",       "depends_on"],
  ["application_component", "technology_service",    "depends_on"],
  // Technology internal
  ["technology_node",       "technology_node",       "depends_on"],
  ["technology_node",       "technology_node",       "composed_of"],
  ["device",                "system_software",       "composed_of"],
  ["device",                "communication_network", "depends_on"],
  // Application internal
  ["application_component", "application_component", "composed_of"],
  ["application_component", "application_service",   "serves"],
  ["application_component", "data_object",           "accesses"],
  // Business internal
  ["business_actor",        "business_role",         "assigned_to"],
  ["business_capability",   "business_capability",   "associated_with"],
  ["business_capability",   "business_capability",   "composed_of"],
  ["value_stream",          "value_stream_stage",    "composed_of"],
  ["value_stream",          "business_capability",   "associated_with"],
  // Motivation → Strategy / Business
  ["goal",                  "business_capability",   "influences"],
  ["goal",                  "capability",            "influences"],
  ["requirement",           "application_component", "influences"],
  ["requirement",           "business_capability",   "influences"],
  ["constraint",            "application_component", "influences"],
  ["driver",                "goal",                  "influences"],
  ["stakeholder",           "driver",                "associated_with"],
  ["principle",             "goal",                  "influences"],
  // Implementation & Migration
  ["work_package",          "goal",                  "associated_with"],
  ["work_package",          "deliverable",           "associated_with"],
  ["plateau",               "business_capability",   "associated_with"],
  ["gap",                   "plateau",               "associated_with"],
];

// ─── DQ stage-gate rules ──────────────────────────────────────────────────────

type DqRuleDef = {
  elementTypeSlug: string;      // which element type this rule targets
  name: string;
  description: string;
  lifecycleStage: string;       // fires when element advances TO this stage
  severity: "error" | "warn";
  rule: Prisma.InputJsonValue;
};

const DQ_RULES: DqRuleDef[] = [
  {
    // ApplicationComponent must realize a BusinessCapability before entering design.
    // Direction: application_component → REALIZES → business_capability (matches RULES table).
    // Targets the component (FROM side) so the evaluator's outgoing-edge query is correct.
    elementTypeSlug: "application_component",
    name: "ApplicationComponent must realize a BusinessCapability before design",
    description: "An Application Component must be linked to a Business Capability via Realizes before entering the design stage",
    lifecycleStage: "design",
    severity: "error",
    rule: { requires: { relationshipType: "realizes", toElementType: "business_capability", minCount: 1 } },
  },
  {
    elementTypeSlug: "application_component",
    name: "ApplicationComponent must bridge to a DigitalProduct before build",
    description: "An Application Component must be linked to a DigitalProduct (the operational manifestation) before entering build",
    lifecycleStage: "build",
    severity: "error",
    rule: { requires: { bridge: "digitalProductId" } },
  },
  {
    elementTypeSlug: "application_component",
    name: "Collision: multiple design-stage elements bridging same DigitalProduct",
    description: "Two or more ApplicationComponents in design stage reference the same DigitalProduct — possible change programme collision",
    lifecycleStage: "build",
    severity: "warn",
    rule: { warns: { duplicateBridge: { lifecycleStage: "design", maxCount: 1 } } },
  },
  {
    elementTypeSlug: "application_component",
    name: "ApplicationComponent must depend on a TechnologyNode before production",
    description: "An Application Component must have at least one TechnologyNode dependency before entering production",
    lifecycleStage: "production",
    severity: "error",
    rule: { requires: { relationshipType: "depends_on", toElementType: "technology_node", minCount: 1 } },
  },
];

// ─── Seed function ────────────────────────────────────────────────────────────

export async function seedEaArchimate4(): Promise<void> {
  // 1. Upsert notation
  const notation = await prisma.eaNotation.upsert({
    where:  { slug: "archimate4" },
    update: { name: "ArchiMate 4", version: "4.0" },
    create: { slug: "archimate4", name: "ArchiMate 4", version: "4.0" },
  });
  console.log(`Seeded EaNotation: ${notation.slug}`);

  // 2. Upsert element types
  const etMap = new Map<string, string>(); // slug → id
  for (const et of ELEMENT_TYPES) {
    const record = await prisma.eaElementType.upsert({
      where:  { notationId_slug: { notationId: notation.id, slug: et.slug } },
      update: {
        name: et.name, neoLabel: et.neoLabel, domain: et.domain,
        description: et.description ?? null,
        validLifecycleStages: et.stages, validLifecycleStatuses: et.statuses,
      },
      create: {
        notationId: notation.id, slug: et.slug, name: et.name,
        neoLabel: et.neoLabel, domain: et.domain,
        description: et.description ?? null,
        validLifecycleStages: et.stages, validLifecycleStatuses: et.statuses,
      },
    });
    etMap.set(et.slug, record.id);
  }
  console.log(`Seeded ${ELEMENT_TYPES.length} EaElementTypes`);

  // 3. Upsert relationship types
  const rtMap = new Map<string, string>(); // slug → id
  for (const rt of REL_TYPES) {
    const record = await prisma.eaRelationshipType.upsert({
      where:  { notationId_slug: { notationId: notation.id, slug: rt.slug } },
      update: { name: rt.name, neoType: rt.neoType, description: rt.description ?? null },
      create: { notationId: notation.id, slug: rt.slug, name: rt.name, neoType: rt.neoType, description: rt.description ?? null },
    });
    rtMap.set(rt.slug, record.id);
  }
  console.log(`Seeded ${REL_TYPES.length} EaRelationshipTypes`);

  // 4. Upsert relationship rules
  for (const [fromSlug, toSlug, relSlug] of RULES) {
    const fromId = etMap.get(fromSlug);
    const toId   = etMap.get(toSlug);
    const relId  = rtMap.get(relSlug);
    if (!fromId || !toId || !relId) {
      console.warn(`Skipping rule ${fromSlug} -[${relSlug}]-> ${toSlug}: slug not found`);
      continue;
    }
    await prisma.eaRelationshipRule.upsert({
      where: { fromElementTypeId_toElementTypeId_relationshipTypeId: { fromElementTypeId: fromId, toElementTypeId: toId, relationshipTypeId: relId } },
      update: {}, // no mutable fields — presence of the triple is the invariant
      create: { fromElementTypeId: fromId, toElementTypeId: toId, relationshipTypeId: relId },
    });
  }
  console.log(`Seeded ${RULES.length} EaRelationshipRules`);

  // 5. Upsert DQ rules
  for (const dq of DQ_RULES) {
    const etId = etMap.get(dq.elementTypeSlug);
    if (!etId) {
      console.warn(`Skipping DQ rule "${dq.name}": element type "${dq.elementTypeSlug}" not found`);
      continue;
    }
    // Use name as upsert key (unique enough within this notation).
    // Non-atomic findFirst/create — safe for sequential seed runs; not safe for concurrent seeds.
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
  console.log(`Seeded ${DQ_RULES.length} EaDqRules`);
}
