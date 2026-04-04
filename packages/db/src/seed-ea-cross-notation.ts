// packages/db/src/seed-ea-cross-notation.ts
// Cross-notation relationship types that link elements across different notations
// (e.g., ArchiMate structural elements ↔ BPMN behavioural elements).
// Registered under a dedicated pseudo-notation "dpf-cross-notation" because
// EaRelationshipType requires a notationId and cross-notation types don't belong
// to either ArchiMate or BPMN.
// Safe to re-run (upsert pattern throughout).
// Spec: docs/superpowers/specs/2026-04-03-value-stream-team-architecture-design.md §2.4

import { prisma } from "./client.js";

// ─── Cross-notation relationship types ────────────────────────────────────────

type RelTypeDef = {
  slug: string;
  name: string;
  neoType: string;
  description: string;
};

const CROSS_NOTATION_REL_TYPES: RelTypeDef[] = [
  {
    slug: "details",
    name: "Details",
    neoType: "DETAILS",
    description: "BPMN element provides behavioural detail for an ArchiMate structural element (e.g., bpmn_process details business_process)",
  },
  {
    slug: "performs",
    name: "Performs",
    neoType: "PERFORMS",
    description: "BPMN lane identifies the performer of an ArchiMate function or role (e.g., bpmn_lane performs business_function)",
  },
  {
    slug: "realizes_process",
    name: "Realizes Process",
    neoType: "REALIZES_PROCESS",
    description: "ArchiMate application component realizes a BPMN automated task (e.g., application_component realizes_process bpmn_service_task)",
  },
];

// ─── Cross-notation relationship rules ────────────────────────────────────────
// These rules link element types across notations. The from/to element type
// lookups resolve against any notation — the rule just needs valid element type IDs.

type CrossRuleDef = {
  fromNotation: string;
  fromSlug: string;
  toNotation: string;
  toSlug: string;
  relSlug: string;
};

const CROSS_RULES: CrossRuleDef[] = [
  // details: BPMN provides behavioural detail for ArchiMate
  { fromNotation: "bpmn20",     fromSlug: "bpmn_process",       toNotation: "archimate4", toSlug: "business_process",       relSlug: "details" },
  { fromNotation: "bpmn20",     fromSlug: "bpmn_service_task",  toNotation: "archimate4", toSlug: "business_function",      relSlug: "details" },
  { fromNotation: "bpmn20",     fromSlug: "bpmn_user_task",     toNotation: "archimate4", toSlug: "business_function",      relSlug: "details" },
  { fromNotation: "bpmn20",     fromSlug: "bpmn_start_event",   toNotation: "archimate4", toSlug: "business_event",         relSlug: "details" },
  { fromNotation: "bpmn20",     fromSlug: "bpmn_end_event",     toNotation: "archimate4", toSlug: "business_event",         relSlug: "details" },
  { fromNotation: "bpmn20",     fromSlug: "bpmn_pool",          toNotation: "archimate4", toSlug: "business_collaboration", relSlug: "details" },

  // performs: BPMN lane identifies the performer
  { fromNotation: "bpmn20",     fromSlug: "bpmn_lane",          toNotation: "archimate4", toSlug: "business_actor",         relSlug: "performs" },
  { fromNotation: "bpmn20",     fromSlug: "bpmn_lane",          toNotation: "archimate4", toSlug: "business_role",          relSlug: "performs" },
  { fromNotation: "bpmn20",     fromSlug: "bpmn_lane",          toNotation: "archimate4", toSlug: "ai_coworker",            relSlug: "performs" },

  // realizes_process: ArchiMate component implements BPMN automated task
  { fromNotation: "archimate4", fromSlug: "application_component", toNotation: "bpmn20", toSlug: "bpmn_service_task",       relSlug: "realizes_process" },
  { fromNotation: "archimate4", fromSlug: "application_component", toNotation: "bpmn20", toSlug: "bpmn_script_task",        relSlug: "realizes_process" },
  { fromNotation: "archimate4", fromSlug: "application_component", toNotation: "bpmn20", toSlug: "bpmn_business_rule_task", relSlug: "realizes_process" },
];

// ─── Seed function ────────────────────────────────────────────────────────────

export async function seedEaCrossNotation(): Promise<void> {
  // 1. Upsert the pseudo-notation
  const notation = await prisma.eaNotation.upsert({
    where:  { slug: "dpf-cross-notation" },
    update: { name: "DPF Cross-Notation", version: "1.0" },
    create: { slug: "dpf-cross-notation", name: "DPF Cross-Notation", version: "1.0" },
  });
  console.log(`Seeded EaNotation: ${notation.slug}`);

  // 2. Upsert cross-notation relationship types
  const rtMap = new Map<string, string>();
  for (const rt of CROSS_NOTATION_REL_TYPES) {
    const record = await prisma.eaRelationshipType.upsert({
      where:  { notationId_slug: { notationId: notation.id, slug: rt.slug } },
      update: { name: rt.name, neoType: rt.neoType, description: rt.description },
      create: { notationId: notation.id, slug: rt.slug, name: rt.name, neoType: rt.neoType, description: rt.description },
    });
    rtMap.set(rt.slug, record.id);
  }
  console.log(`Seeded ${CROSS_NOTATION_REL_TYPES.length} cross-notation EaRelationshipTypes`);

  // 3. Resolve element type IDs across notations and upsert rules
  let ruleCount = 0;
  for (const cr of CROSS_RULES) {
    const fromNotation = await prisma.eaNotation.findUnique({ where: { slug: cr.fromNotation } });
    const toNotation   = await prisma.eaNotation.findUnique({ where: { slug: cr.toNotation } });
    if (!fromNotation || !toNotation) {
      console.warn(`Skipping cross-notation rule: notation ${cr.fromNotation} or ${cr.toNotation} not found`);
      continue;
    }
    const fromType = await prisma.eaElementType.findUnique({
      where: { notationId_slug: { notationId: fromNotation.id, slug: cr.fromSlug } },
    });
    const toType = await prisma.eaElementType.findUnique({
      where: { notationId_slug: { notationId: toNotation.id, slug: cr.toSlug } },
    });
    const relId = rtMap.get(cr.relSlug);
    if (!fromType || !toType || !relId) {
      console.warn(`Skipping cross-notation rule ${cr.fromSlug} -[${cr.relSlug}]-> ${cr.toSlug}: type not found`);
      continue;
    }
    await prisma.eaRelationshipRule.upsert({
      where: { fromElementTypeId_toElementTypeId_relationshipTypeId: { fromElementTypeId: fromType.id, toElementTypeId: toType.id, relationshipTypeId: relId } },
      update: {},
      create: { fromElementTypeId: fromType.id, toElementTypeId: toType.id, relationshipTypeId: relId },
    });
    ruleCount++;
  }
  console.log(`Seeded ${ruleCount} cross-notation EaRelationshipRules`);
}
