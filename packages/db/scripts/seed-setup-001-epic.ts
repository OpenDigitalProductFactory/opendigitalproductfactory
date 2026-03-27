// One-off script: seed EP-SETUP-001 epic and backlog items
// Run from repo root: pnpm --filter @dpf/db exec tsx scripts/seed-setup-001-epic.ts
import { prisma } from "../src/client";

async function main() {
  const portfolios = await prisma.portfolio.findMany({
    select: { id: true, slug: true, name: true },
  });
  const bySlug = Object.fromEntries(portfolios.map((p) => [p.slug, p]));

  console.log("Portfolios found:", portfolios.map((p) => p.slug));

  const epicDef = {
    epicId: "EP-SETUP-001",
    title: "Smart Setup Handoff: Auto-detect Business Name, Type, and Currency from Branding URL",
    description:
      "When a company URL is used during the branding setup step, the platform detects the company name, " +
      "business archetype, and country/currency from the site content and carries those suggestions forward " +
      "to subsequent setup steps. Company name pre-fills the org settings and storefront wizard (eliminating " +
      "duplicate entry). Archetype suggestion pre-highlights the matched storefront type with a dismissable " +
      "banner. Country detection sets the default currency (overriding the GBP fallback) for the finance step. " +
      "All suggestions are advisory — the user overrides freely. Extends analyze_public_website_branding to " +
      "return suggestedArchetypeId, businessCategory, archetypeConfidence, suggestedCountryCode, and " +
      "suggestedCurrency. No schema migrations required — all state lives in the existing context JSON column.",
    status: "open" as const,
    portfolioSlugs: ["products_and_services_sold", "for_employees"],
    stories: [
      // Phase 1 — Detection Logic
      {
        title: "Extend analyze_public_website_branding tool output schema with suggestedArchetypeId, businessCategory, archetypeConfidence, suggestedCountryCode, suggestedCurrency",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 1,
      },
      {
        title: "Update analyze-website-branding AI prompt to detect business type (archetype catalog), country, and currency from site content (address, phone format, price symbols, TLD)",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 2,
      },
      // Phase 2 — Setup Context Propagation
      {
        title: "Extend SetupContext type with suggestedCompanyName, suggestedArchetypeId, suggestedArchetypeName, suggestedCurrency, suggestedCountryCode, brandingSourceUrl",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 3,
      },
      {
        title: "Write URL analysis suggestions to PlatformSetupProgress.context: company name (always), archetype (medium/high confidence only), currency and country (always if detected)",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 4,
      },
      {
        title: "Add getSetupContext() read action to setup-progress.ts for server components to retrieve accumulated context",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 5,
      },
      // Phase 3 — Company Name Pre-fill
      {
        title: "Org settings page reads suggestedCompanyName from context and pre-fills company name field with attribution note if org name is still at bootstrap value",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 6,
      },
      // Phase 4 — Currency Pre-fill
      {
        title: "Finance settings page reads suggestedCurrency from context and pre-selects default currency (overriding GBP fallback) with attribution note",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 7,
      },
      // Phase 5 — Archetype Pre-selection
      {
        title: "Storefront setup page reads suggestedArchetypeId from context and passes it to the archetype picker component",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 8,
      },
      {
        title: "Archetype picker renders dismissable suggestion banner citing the source URL when a suggestion is present",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 9,
      },
      {
        title: "Suggested archetype card has highlight ring and Suggested badge; grid scrolls to bring it into view",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 10,
      },
      // Phase 6 — Testing & Docs
      {
        title: "Integration tests: URL import persists company name, archetype (confidence filter), and currency; no-URL path leaves context clean",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 11,
      },
      {
        title: "Update setup flow documentation to describe branding URL handoff to org settings, finance, and storefront steps",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 12,
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

    // Upsert any missing items
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
