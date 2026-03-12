// One-off script: seed the 5 vision epics and their initial stories
// Run from repo root: pnpm --filter @dpf/db exec tsx scripts/seed-vision-epics.ts
import { randomUUID } from "crypto";
import { prisma } from "../src/client";

async function main() {
  // 1. Get portfolio IDs
  const portfolios = await prisma.portfolio.findMany({
    select: { id: true, slug: true, name: true },
  });
  const bySlug = Object.fromEntries(portfolios.map((p) => [p.slug, p]));

  console.log("Portfolios found:", portfolios.map((p) => p.slug));

  const foundational   = bySlug["foundational"];
  const mfgDelivery    = bySlug["manufacturing_and_delivery"];
  const forEmployees   = bySlug["for_employees"];

  if (!foundational || !mfgDelivery || !forEmployees) {
    throw new Error("Expected portfolios not found — run the seed first.");
  }

  // 2. Define epics + their portfolio links + their stories
  const epics = [
    {
      epicId: `EP-${randomUUID()}`,
      title: "Neo4j + Digital Product Backbone",
      description:
        "Establish Neo4j as the graph store for the Digital Product Backbone. Model cross-domain relationships (concept-to-operational), provider/consumer dependencies, and IT4IT data objects. This is the foundation for EA Modeler, impact analysis, and infrastructure registry.",
      status: "open",
      portfolioSlugs: ["foundational", "manufacturing_and_delivery"],
      stories: [
        { title: "Provision Neo4j instance and register it as a foundational infrastructure CI", type: "portfolio", status: "open", priority: 1 },
        { title: "Define graph schema v1 for Digital Product entities (concept → logical → physical layers)", type: "portfolio", status: "open", priority: 2 },
        { title: "Implement provider/consumer relationship model (directed edges with role metadata)", type: "portfolio", status: "open", priority: 3 },
        { title: "Build Cypher query API layer for graph traversal (impact analysis foundation)", type: "portfolio", status: "open", priority: 4 },
        { title: "Sync Prisma DigitalProduct and TaxonomyNode records into Neo4j on write", type: "portfolio", status: "open", priority: 5 },
        { title: "Map IT4IT S2P, R2D, R2F, D2C data objects to graph node types", type: "portfolio", status: "open", priority: 6 },
        { title: "Seed Neo4j with foundational portfolio infrastructure nodes (PostgreSQL, Neo4j, Docker)", type: "portfolio", status: "open", priority: 7 },
      ],
    },
    {
      epicId: `EP-${randomUUID()}`,
      title: "EA Modeler",
      description:
        "Graph-native enterprise architecture modelling canvas built on JointJS + ArchiMate 4. Neo4j owns the semantic model. Scenarios capture proposed future states. Snapshots are immutable approval artefacts. Whiteboard-first interaction model with drag-to-connect and direct manipulation.",
      status: "open",
      portfolioSlugs: ["manufacturing_and_delivery"],
      stories: [
        { title: "Route /ea/modeler: full-viewport canvas page (HR-300, HR-000 access)", type: "product", status: "open", priority: 1 },
        { title: "JointJS canvas setup with ArchiMate 4 shape library (18 element types, 4 layers)", type: "product", status: "open", priority: 2 },
        { title: "ELK.js auto-layout integration (layered + flow modes, lazy-load WASM bundle)", type: "product", status: "open", priority: 3 },
        { title: "Scenario management CRUD (ModelScenario: draft → active → submitted → approved)", type: "product", status: "open", priority: 4 },
        { title: "Viewpoint catalog: 4 viewpoints (Application Architecture, Technology/Deployment, Business Process, Portfolio/Capability)", type: "product", status: "open", priority: 5 },
        { title: "Drag-to-connect interaction: port magnets, ghost link, valid/invalid target highlighting", type: "product", status: "open", priority: 6 },
        { title: "Element search modal: search operational elements, reference vs. propose dialog", type: "product", status: "open", priority: 7 },
        { title: "Snapshot creation: freeze subgraph JSON as ModelSnapshot, generate DR artifact", type: "product", status: "open", priority: 8 },
        { title: "Lifecycle state visual encoding: current (solid) / proposed (dashed) / approved (green) / retired (grey)", type: "product", status: "open", priority: 9 },
      ],
    },
    {
      epicId: `EP-${randomUUID()}`,
      title: "Infrastructure Registry",
      description:
        "Operational footprint registry: track Docker instances, databases, services, and their provider/consumer relationships across portfolios. Links the foundational infrastructure to the manufacturing domain. Enables dependency impact analysis and operational visibility.",
      status: "open",
      portfolioSlugs: ["foundational"],
      stories: [
        { title: "Infrastructure CI model: node types (server, container, database, service, network)", type: "portfolio", status: "open", priority: 1 },
        { title: "Register existing instances: PostgreSQL, Neo4j, Docker host as foundational CIs", type: "portfolio", status: "open", priority: 2 },
        { title: "Provider/consumer relationship UI: link CIs with directed dependency edges", type: "portfolio", status: "open", priority: 3 },
        { title: "Infrastructure registry page: filterable CI list with status, type, owner portfolio", type: "portfolio", status: "open", priority: 4 },
        { title: "CI detail view: show upstream providers and downstream consumers from Neo4j graph", type: "portfolio", status: "open", priority: 5 },
        { title: "Health status tracking: operational / degraded / offline with last-seen timestamp", type: "portfolio", status: "open", priority: 6 },
        { title: "Link infrastructure CIs to taxonomy nodes for ownership domain attribution", type: "portfolio", status: "open", priority: 7 },
      ],
    },
    {
      epicId: `EP-${randomUUID()}`,
      title: "Unified Work Item Types (Phase 6B)",
      description:
        "Extend the backlog system with a workItemType discriminator (story, bug, enabler, improvement, demand, incident, problem, change-request) and ITSM traceability fields (originType, originId). Enables the D2C-to-R2D traceability chain: incident → problem → bug → story.",
      status: "open",
      portfolioSlugs: ["manufacturing_and_delivery"],
      stories: [
        { title: "Add workItemType field to BacklogItem schema (story | bug | enabler | improvement | demand | incident | problem | change-request)", type: "portfolio", status: "open", priority: 1 },
        { title: "Add originType and originId traceability fields to BacklogItem", type: "portfolio", status: "open", priority: 2 },
        { title: "Update BacklogPanel UI: workItemType selector with type-specific field visibility", type: "portfolio", status: "open", priority: 3 },
        { title: "Bug type: add severity (1-4), steps to reproduce, expected vs actual fields", type: "portfolio", status: "open", priority: 4 },
        { title: "Incident type: add urgency, impact, affected CI, SLA deadline, breach flag fields", type: "portfolio", status: "open", priority: 5 },
        { title: "OpsClient: group and filter unassigned items by workItemType", type: "portfolio", status: "open", priority: 6 },
        { title: "Spawn delivery item from ITSM record: link Bug/Story back to originating Incident/Problem", type: "portfolio", status: "open", priority: 7 },
        { title: "Update backlog.ts constants and validators for all workItemTypes", type: "portfolio", status: "open", priority: 8 },
      ],
    },
    {
      epicId: `EP-${randomUUID()}`,
      title: "ITSM Module",
      description:
        "Native incident, problem, known error, change request, and service request management — purpose-built for small-to-mid sized companies who cannot justify a full ServiceNow deployment. Implements the IT4IT Detect to Correct (D2C) and Request to Fulfill (R2F) value streams within the platform.",
      status: "open",
      portfolioSlugs: ["manufacturing_and_delivery", "for_employees"],
      stories: [
        { title: "Incident management: create, update, resolve with urgency/impact/priority matrix and SLA tracking", type: "portfolio", status: "open", priority: 1 },
        { title: "Problem management: link incidents, record RCA, promote to Known Error", type: "portfolio", status: "open", priority: 2 },
        { title: "Known Error Database (KEDB): workaround documentation, fix decision tracking", type: "portfolio", status: "open", priority: 3 },
        { title: "Change Request workflow: standard/normal/emergency types, approval chain, CAB decision", type: "portfolio", status: "open", priority: 4 },
        { title: "Service Request catalog: catalog items, fulfillment workflow, SLA tracking", type: "portfolio", status: "open", priority: 5 },
        { title: "D2C-to-R2D traceability: spawn backlog items from ITSM records with full link chain", type: "portfolio", status: "open", priority: 6 },
        { title: "/itsm route: unified ITSM dashboard (active incidents, open problems, pending changes)", type: "portfolio", status: "open", priority: 7 },
        { title: "Notification and escalation: SLA breach alerts, pending approval reminders", type: "portfolio", status: "open", priority: 8 },
      ],
    },
  ];

  // 3. Create each epic with its portfolio links and stories
  for (const epicDef of epics) {
    console.log(`\nCreating epic: ${epicDef.title}`);

    const portfolioIds = epicDef.portfolioSlugs
      .map((slug) => bySlug[slug]?.id)
      .filter((id): id is string => id !== undefined);

    // Create epic + portfolio links in a transaction
    const epic = await prisma.$transaction(async (tx) => {
      const created = await tx.epic.create({
        data: {
          epicId:      epicDef.epicId,
          title:       epicDef.title,
          description: epicDef.description,
          status:      epicDef.status,
        },
      });
      if (portfolioIds.length > 0) {
        await tx.epicPortfolio.createMany({
          data: portfolioIds.map((portfolioId) => ({
            epicId:     created.id,
            portfolioId,
          })),
        });
      }
      return created;
    });

    console.log(`  Created epic ${epic.epicId} (id: ${epic.id})`);

    // Create stories linked to the epic
    for (const story of epicDef.stories) {
      const item = await prisma.backlogItem.create({
        data: {
          itemId:   `BI-${randomUUID()}`,
          title:    story.title,
          type:     story.type,
          status:   story.status,
          priority: story.priority,
          epicId:   epic.id,
        },
      });
      console.log(`    Story: ${item.itemId} — ${item.title.slice(0, 60)}…`);
    }
  }

  console.log("\n✅ Done. 5 epics and their stories created.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
