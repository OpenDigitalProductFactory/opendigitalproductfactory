// One-off script: seed EP-EA-001 epic and backlog items
// Run from repo root: pnpm --filter @dpf/db exec tsx scripts/seed-ea-diagram-ux-epic.ts
import { prisma } from "../src/client";

async function main() {
  const portfolios = await prisma.portfolio.findMany({
    select: { id: true, slug: true, name: true },
  });
  const bySlug = Object.fromEntries(portfolios.map((p) => [p.slug, p]));
  console.log("Portfolios found:", portfolios.map((p) => p.slug));

  const epicDef = {
    epicId: "EP-EA-001",
    title: "EA Ontology Diagram UX",
    description:
      "Provides a user interface for creating, navigating, and managing Enterprise Architecture " +
      "diagrams backed by the ontology graph built in the ArchiMate 4 refactor. Introduces a " +
      "persisted EaDiagram model (named views with element selections and layout), a diagram canvas " +
      "that renders elements and relationships from live graph data, an element picker for adding " +
      "nodes to a diagram, a traversal pattern runner that visualises the output of named patterns " +
      "(blast_radius, governance_audit, etc.), and export to Mermaid / Archi XML. Also covers the " +
      "ArchiMate import UI so architects can drag-and-drop .archimate files from Archi tool. " +
      "Static .mmd files in docs/architecture are the interim solution and will be superseded by " +
      "this capability.",
    status: "open" as const,
    portfolioSlugs: ["for_employees", "manufacturing_and_delivery"],
    stories: [
      {
        title: "Schema: add EaDiagram model (id, notationId, name, slug, description, elementIds[], layoutJson, createdBy, timestamps); migration and Prisma generate",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 1,
      },
      {
        title: "Diagram list page: /admin/ea/diagrams — list saved diagrams with name, element count, last modified; create and delete actions",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 2,
      },
      {
        title: "Diagram viewer component: render selected EaElements and their relationships as an interactive graph (start with Mermaid; replace with React Flow in a follow-on)",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 3,
      },
      {
        title: "Element picker panel: search/filter ontology elements by type slug, refinement level, name; add/remove from current diagram; shows element count per type",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 4,
      },
      {
        title: "Traversal pattern runner UI: select a named pattern + one or more start elements; run run_traversal_pattern MCP tool; render result paths in diagram viewer",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 5,
      },
      {
        title: "Export panel: download current diagram view as Mermaid (.mmd), SVG, or Archi XML (.archimate) via the export_archimate server action",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 6,
      },
      {
        title: "ArchiMate import UI: drag-and-drop .archimate file upload on /admin/ea/diagrams; preview elements to be created; call import_archimate server action; show conformance issues",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 7,
      },
    ],
  };

  // Idempotency: check if epic already exists
  const existing = await prisma.epic.findFirst({
    where: { epicId: epicDef.epicId },
  });
  if (existing) {
    console.log(`  Epic already exists: ${existing.epicId} — checking backlog items...`);
    const existingItems = await prisma.backlogItem.findMany({
      where: { epicId: existing.id },
      select: { itemId: true },
    });
    let created = 0;
    for (const story of epicDef.stories) {
      const itemId = `${epicDef.epicId}-${String(story.priority).padStart(3, "0")}`;
      if (!existingItems.some((i) => i.itemId === itemId)) {
        await prisma.backlogItem.create({
          data: {
            itemId,
            title: story.title,
            type: story.type,
            status: story.status,
            priority: story.priority,
            epicId: existing.id,
            source: "spec",
          },
        });
        console.log(`    + Created missing item: ${itemId}`);
        created++;
      }
    }
    if (created === 0) {
      console.log("  All backlog items already present — nothing to do.");
    } else {
      console.log(`  Restored ${created} missing backlog items.`);
    }
    return;
  }

  // Create the epic
  const epic = await prisma.epic.create({
    data: {
      epicId: epicDef.epicId,
      title: epicDef.title,
      description: epicDef.description,
      status: epicDef.status,
    },
  });
  console.log(`  Created epic: ${epic.title} (${epic.epicId})`);

  // Link portfolios
  for (const slug of epicDef.portfolioSlugs) {
    const portfolio = bySlug[slug];
    if (!portfolio) {
      console.log(`    Portfolio "${slug}" not found — skipping link`);
      continue;
    }
    await prisma.epicPortfolio.create({
      data: { epicId: epic.id, portfolioId: portfolio.id },
    });
    console.log(`    Linked to portfolio: ${slug}`);
  }

  // Create backlog items
  for (const story of epicDef.stories) {
    const itemId = `${epicDef.epicId}-${String(story.priority).padStart(3, "0")}`;
    await prisma.backlogItem.create({
      data: {
        itemId,
        title: story.title,
        type: story.type,
        status: story.status,
        priority: story.priority,
        epicId: epic.id,
        source: "spec",
      },
    });
    console.log(`    + ${itemId}`);
  }

  console.log(`\n  Created ${epicDef.stories.length} backlog items`);
  console.log("\nDone.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
