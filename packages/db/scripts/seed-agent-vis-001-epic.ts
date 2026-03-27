// One-off script: seed EP-AGENT-VIS-001 epic and backlog items
// Run from repo root: pnpm --filter @dpf/db exec tsx scripts/seed-agent-vis-001-epic.ts
import { prisma } from "../src/client";

async function main() {
  const portfolios = await prisma.portfolio.findMany({
    select: { id: true, slug: true, name: true },
  });
  const bySlug = Object.fromEntries(portfolios.map((p) => [p.slug, p]));

  console.log("Portfolios found:", portfolios.map((p) => p.slug));

  const epicDef = {
    epicId: "EP-AGENT-VIS-001",
    title: "Agent Page Visibility in Hands Off Mode",
    description:
      "Decouples read context (page visibility) from write permission (form field updates) in the " +
      "agent coworker form assist system. Currently both reading and writing are gated behind a single " +
      "elevatedAssistEnabled flag, leaving the agent blind to page state in Hands Off mode. " +
      "The fix: always build formAssistContext when a form assist adapter is registered for the route, " +
      "pass a formAssistReadOnly flag to sendMessage, inject read-only context into the agent prompt " +
      "unconditionally, and only extract formAssistUpdate when elevatedFormFillEnabled is true. " +
      "The agent can then answer questions about current field values in Hands Off mode without " +
      "being able to modify them. No schema changes, no UI changes — the Hands On/Off toggle " +
      "continues to mean exactly what it says.",
    status: "open" as const,
    portfolioSlugs: ["for_employees"],
    stories: [
      {
        title: "Remove elevatedAssistEnabled gate from getActiveFormAssist call in AgentCoworkerPanel — always build read context when an adapter is registered",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 1,
      },
      {
        title: "Derive formAssistReadOnly flag (activeFormAssist !== null && !elevatedAssistEnabled) and pass it to sendMessage alongside formAssistContext",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 2,
      },
      {
        title: "Add options?: { readOnly?: boolean } to buildFormAssistInstruction in agent-form-assist.ts; implement read-only instruction variant that omits field update block",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 3,
      },
      {
        title: "In agent-coworker.ts, split prompt injection (runs whenever formAssistContext is present) from response extraction (only when elevatedFormFillEnabled is true)",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 4,
      },
      {
        title: "Tests: read-only instruction omits update block; Hands Off passes context with readOnly flag; Hands On behaviour unchanged; no adapter registered = no context in either mode",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 5,
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
