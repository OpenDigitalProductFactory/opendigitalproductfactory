// One-off script: seed EP-BIZ-ROLES epic and 18 backlog items
// Run from repo root: pnpm --filter @dpf/db exec tsx scripts/seed-biz-roles-epic.ts
import { prisma } from "../src/client";

async function main() {
  const portfolios = await prisma.portfolio.findMany({
    select: { id: true, slug: true, name: true },
  });
  const bySlug = Object.fromEntries(portfolios.map((p) => [p.slug, p]));

  console.log("Portfolios found:", portfolios.map((p) => p.slug));

  const mfgDelivery = bySlug["manufacturing_and_delivery"];
  const forEmployees = bySlug["for_employees"];
  const productsSold = bySlug["products_and_services_sold"];

  if (!mfgDelivery) {
    throw new Error("manufacturing_and_delivery portfolio not found — run seed first.");
  }

  const epicDef = {
    epicId: "EP-BIZ-ROLES",
    title: "Business Model Roles",
    description:
      "Two-tier role architecture that extends the six immutable platform governance roles " +
      "(HR-000..HR-500) with business-model-specific operational roles scoped per digital product. " +
      "Introduces eight pre-defined business model templates (SaaS, Marketplace, E-commerce, " +
      "Professional Services, Media, IoT, Developer Platform, API/Data) each with four role " +
      "definitions (32 roles total). Users can also create custom business models with up to " +
      "twenty roles, or clone a built-in template. Role holders receive agent action proposals " +
      "routed by authority domain before fallback to platform governance roles. Includes " +
      "governance resolver integration, Authority Matrix extension, and Delegation Chain " +
      "visualisation for BMR escalation paths.",
    status: "open" as const,
    portfolioSlugs: ["manufacturing_and_delivery", "for_employees", "products_and_services_sold"],
    stories: [
      // Phase 1 — Data Foundation
      {
        title: "Add Prisma schema models: BusinessModel, BusinessModelRole, ProductBusinessModel, BusinessModelRoleAssignment",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 1,
      },
      {
        title: "Create business_model_registry.json with 8 pre-defined business models and 32 roles",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 2,
      },
      {
        title: "Add seedBusinessModels() function to seed.ts — upsert business models and roles from registry",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 3,
      },
      // Phase 2 — Server Actions & API
      {
        title: "Server actions for assigning and removing business models on digital products",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 4,
      },
      {
        title: "Server actions for assigning and revoking users from business model roles per product",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 5,
      },
      {
        title: "Server actions for custom business model CRUD: create, update, clone, deprecate, retire",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 6,
      },
      {
        title: "API routes GET /api/v1/business-models and /api/v1/business-models/[modelId]",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 7,
      },
      // Phase 3 — UI Components
      {
        title: "BusinessModelSelector component: grouped dropdown to assign business models to a product",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 8,
      },
      {
        title: "BusinessModelRolePanel component: role template display with user assignment slots and escalation badges",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 9,
      },
      {
        title: "Integrate BusinessModelSelector and BusinessModelRolePanel into product detail page",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 10,
      },
      {
        title: "Admin custom business model builder page at /admin/business-models with clone and lifecycle actions",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 11,
      },
      // Phase 4 — Governance Integration
      {
        title: "Extend governance-resolver.ts to resolve BMR authority domains before platform role fallback",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 12,
      },
      {
        title: "Extend agent proposal routing to target BMR role holders for product-scoped proposals",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 13,
      },
      {
        title: "Extend Authority Matrix page and AuthorityMatrixPanel with Business Model Roles section",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 14,
      },
      {
        title: "Extend DelegationChainPanel to show BMR roles as child nodes under escalation target platform roles",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 15,
      },
      {
        title: "Extend EffectivePermissionsPanel with product selector to show BMR authority domain capabilities",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 16,
      },
      // Phase 5 — Testing & Documentation
      {
        title: "Integration tests: seed idempotency, CRUD lifecycle, built-in immutability, assignment constraints",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 17,
      },
      {
        title: "Update platform onboarding documentation to reflect two-tier role model and custom business model creation",
        type: "portfolio" as const,
        status: "open" as const,
        priority: 18,
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
