// One-off script: seed EP-HR-AGENT-001 epic and backlog items
// Run from repo root: pnpm --filter @dpf/db exec tsx scripts/seed-hr-agent-001-epic.ts
import { prisma } from "../src/client";

async function main() {
  const portfolios = await prisma.portfolio.findMany({
    select: { id: true, slug: true, name: true },
  });
  const bySlug = Object.fromEntries(portfolios.map((p) => [p.slug, p]));

  console.log("Portfolios found:", portfolios.map((p) => p.slug));

  const epicDef = {
    epicId: "EP-HR-AGENT-001",
    title: "Fix AI Coworker Employee Creation via HR Director Agent",
    description:
      "Three bugs prevent the HR Director AI Coworker from creating employees. " +
      "(1) create_employee, transition_employee_status, and propose_leave_policy all lack " +
      "executionMode: 'immediate' — without it, agentic-loop.ts treats every HR tool call " +
      "as a proposal (executionMode !== 'immediate' is true when undefined), breaking out of " +
      "the loop before the tool executes. " +
      "(2) departmentId and positionId accept database IDs only, but the agent has no lookup " +
      "tool and no name-based fallback — when the user says 'Engineering' the AI passes the " +
      "name as a FK ID and hits a constraint error. The managerEmployeeId field already resolves " +
      "by name/email; department and position need the same treatment. " +
      "(3) There are no list_departments or list_positions tools, so the agent cannot show the " +
      "user a valid list of options to choose from.",
    status: "open" as const,
    portfolioSlugs: ["for_employees"],
    stories: [
      {
        title: "Bug: Add executionMode: 'immediate' and sideEffect: true to create_employee, transition_employee_status, and propose_leave_policy in mcp-tools.ts",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 1,
      },
      {
        title: "Bug: Add name-based fallback resolution for departmentId and positionId in create_employee tool execution (match by name, same pattern as managerEmployeeId)",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 2,
      },
      {
        title: "Add list_departments tool: returns id, name, and headCount for all active departments — used by agent to present valid choices to the user",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 3,
      },
      {
        title: "Add list_positions tool: returns id, title, and department for all active positions — used by agent to present valid choices to the user",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 4,
      },
      {
        title: "Add workEmail uniqueness check in create_employee with a clear error message rather than a raw constraint error",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 5,
      },
      {
        title: "Integration test: HR Director agent creates employee end-to-end with department and position provided as names (not IDs)",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 6,
      },
    ],
  };

  // Check if epic already exists
  const existing = await prisma.epic.findFirst({
    where: { epicId: epicDef.epicId },
  });
  if (existing) {
    console.log(`  Epic already exists: ${existing.epicId} — checking backlog items...`);

    const existingItems = await prisma.backlogItem.findMany({
      where: { epicId: existing.id },
      select: { itemId: true, title: true },
    });
    console.log(`  ${existingItems.length} backlog items already linked to this epic.`);

    let created = 0;
    for (const story of epicDef.stories) {
      const itemId = `${epicDef.epicId}-${String(story.priority).padStart(3, "0")}`;
      const alreadyExists = existingItems.some((i) => i.itemId === itemId);
      if (!alreadyExists) {
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
      console.log("  All backlog items already present — nothing to restore.");
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
      console.log(`    Portfolio ${slug} not found, skipping link`);
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
  }
  console.log(`  Created ${epicDef.stories.length} backlog items`);

  console.log("\nDone.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
