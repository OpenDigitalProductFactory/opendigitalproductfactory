// packages/db/src/seed-ea-viewpoints.ts
// Notation-aware EA viewpoint seeding.
//
// Extracted from seed.ts (EP per 2026-06-14 SysML substrate spec §10 Phase 1 +
// §11 refactoring budget: "Refactor seedEaViewpoints into a reusable notation-aware
// helper before adding SysML viewpoints"). One helper resolves element/relationship
// type slugs against a named notation and upserts ViewpointDefinitions, so
// ArchiMate, BPMN, and SysML all flow through the same path instead of copy-pasted
// blocks that drift independently.
//
// Safe to re-run (upsert by ViewpointDefinition.name).

import { prisma } from "./client.js";

export type ViewpointSpec = {
  name: string;
  description: string;
  elementSlugs: string[];
  relSlugs: string[];
};

/**
 * Seed ViewpointDefinitions for a single notation. Resolves every element- and
 * relationship-type slug against that notation (throwing if a required notation's
 * slug is missing — a seed-ordering bug), then upserts each viewpoint by name.
 *
 * @param opts.optional when true, silently skip if the notation has not been
 *        seeded yet (used for notations that may not exist in every install).
 * @returns the number of viewpoints seeded (0 if an optional notation is absent).
 */
export async function seedViewpointsForNotation(
  notationSlug: string,
  viewpoints: ViewpointSpec[],
  opts: { optional?: boolean } = {},
): Promise<number> {
  const notation = await prisma.eaNotation.findUnique({
    where: { slug: notationSlug },
    select: { id: true },
  });
  if (!notation) {
    if (opts.optional) {
      console.warn(`Skipping viewpoints for notation "${notationSlug}": notation not seeded`);
      return 0;
    }
    throw new Error(`seedViewpointsForNotation: required notation "${notationSlug}" not found`);
  }
  const nId = notation.id;

  async function resolveElementSlugs(slugs: string[]): Promise<string[]> {
    for (const slug of slugs) {
      await prisma.eaElementType.findUniqueOrThrow({
        where: { notationId_slug: { notationId: nId, slug } },
        select: { id: true },
      });
    }
    return slugs;
  }

  async function resolveRelSlugs(slugs: string[]): Promise<string[]> {
    for (const slug of slugs) {
      await prisma.eaRelationshipType.findUniqueOrThrow({
        where: { notationId_slug: { notationId: nId, slug } },
        select: { id: true },
      });
    }
    return slugs;
  }

  for (const vp of viewpoints) {
    const allowedElementTypeSlugs = await resolveElementSlugs(vp.elementSlugs);
    const allowedRelTypeSlugs = await resolveRelSlugs(vp.relSlugs);
    await prisma.viewpointDefinition.upsert({
      where: { name: vp.name },
      update: { description: vp.description, allowedElementTypeSlugs, allowedRelTypeSlugs },
      create: { name: vp.name, description: vp.description, allowedElementTypeSlugs, allowedRelTypeSlugs },
    });
  }
  console.log(`Seeded ${viewpoints.length} viewpoint definitions for ${notationSlug}`);
  return viewpoints.length;
}

// ─── ArchiMate 4 viewpoints (unchanged from the original seed.ts inline list) ──

export const ARCHIMATE_VIEWPOINTS: ViewpointSpec[] = [
  {
    name: "AI Routing Realization",
    description:
      "Governed AI-routing capability and process, the application components that realize them, and the privacy-safe evidence that verifies operation.",
    elementSlugs: [
      "business_capability",
      "business_process",
      "application_component",
      "event_evidence",
    ],
    relSlugs: ["realizes", "associated_with"],
  },
  {
    name: "Application Architecture",
    description: "Application components, services, data objects, and their relationships.",
    elementSlugs: ["application_component", "application_service", "data_object", "technology_node", "technology_service", "system_software"],
    relSlugs: ["realizes", "assigned_to", "composed_of", "associated_with"],
  },
  {
    name: "Business Architecture",
    description: "Business capabilities, roles, actors, and value streams.",
    elementSlugs: ["business_capability", "business_role", "business_actor", "business_object", "value_stream", "value_stream_stage"],
    relSlugs: ["realizes", "assigned_to", "influences", "composed_of", "associated_with"],
  },
  {
    name: "Technology Architecture",
    description: "Infrastructure nodes, services, and their deployment relationships.",
    elementSlugs: ["technology_node", "technology_service", "system_software", "application_component"],
    relSlugs: ["realizes", "assigned_to", "composed_of", "associated_with"],
  },
  {
    name: "Capability Map",
    description: "Business capability hierarchy.",
    elementSlugs: ["business_capability"],
    relSlugs: ["composed_of", "associated_with"],
  },
  {
    // EP-DATA-ARCH: live ERD mirrored from the Prisma schema (data objects).
    name: "Data Model",
    description: "Logical data model mirrored from the Prisma schema as a live ERD.",
    elementSlugs: ["data_object"],
    relSlugs: ["associated_with"],
  },
];

// ─── BPMN 2.0 viewpoints (unchanged from the original seed.ts inline list) ─────

export const BPMN_VIEWPOINTS: ViewpointSpec[] = [
  {
    name: "Process Architecture",
    description: "BPMN process flows with activities, gateways, events, and swimlanes. Shows who does what (AI coworker or human) and where decisions branch.",
    elementSlugs: [
      "bpmn_process", "bpmn_sub_process", "bpmn_service_task", "bpmn_user_task",
      "bpmn_manual_task", "bpmn_script_task", "bpmn_business_rule_task",
      "bpmn_exclusive_gateway", "bpmn_parallel_gateway", "bpmn_inclusive_gateway",
      "bpmn_start_event", "bpmn_end_event", "bpmn_intermediate_throw_event", "bpmn_intermediate_catch_event",
      "bpmn_pool", "bpmn_lane",
      "bpmn_data_object", "bpmn_data_input", "bpmn_data_output",
    ],
    relSlugs: ["sequence_flow", "message_flow", "data_association", "conditional_flow", "default_flow", "association"],
  },
];

// ─── SysML v2 viewpoints (new — 2026-06-14 SysML substrate spec §10 Phase 1) ───

export const SYSML_VIEWPOINTS: ViewpointSpec[] = [
  {
    name: "Systems Requirements & Verification",
    description: "SysML requirements and constraints, the design elements that satisfy them, and the verification cases that prove them. The traceability/verification viewpoint.",
    elementSlugs: ["requirement", "constraint", "part_definition", "part_usage", "verification_case", "analysis_case"],
    relSlugs: ["satisfies", "verifies", "refines", "traces", "allocates", "contains"],
  },
  {
    name: "System Decomposition & Interfaces",
    description: "SysML parts, ports, and interface definitions showing system structure, specialization, connections, and route redirect forwards.",
    elementSlugs: ["package", "part_definition", "part_usage", "interface_definition", "port", "state", "action"],
    relSlugs: ["contains", "specializes", "connects", "allocates", "redirects_to"],
  },
];

/**
 * Seed all EA viewpoints across notations. ArchiMate is required (it is always
 * seeded first); BPMN and SysML are optional so installs that have not seeded
 * those notations yet do not fail.
 */
export async function seedEaViewpoints(): Promise<void> {
  await seedViewpointsForNotation("archimate4", ARCHIMATE_VIEWPOINTS);
  await seedViewpointsForNotation("bpmn20", BPMN_VIEWPOINTS, { optional: true });
  await seedViewpointsForNotation("sysml2", SYSML_VIEWPOINTS, { optional: true });
}
