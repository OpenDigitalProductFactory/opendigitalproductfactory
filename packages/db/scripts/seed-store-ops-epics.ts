// One-off script: seed EP-STORE-OPS and EP-STORE-SCHED epics
// Run from repo root: pnpm --filter @dpf/db exec tsx scripts/seed-store-ops-epics.ts
import { prisma } from "../src/client";

async function main() {
  const storefront = await prisma.portfolio.findUnique({ where: { slug: "products_and_services_sold" } });
  const foundational = await prisma.portfolio.findUnique({ where: { slug: "foundational" } });
  if (!storefront) throw new Error("products_and_services_sold portfolio not seeded");
  if (!foundational) throw new Error("foundational portfolio not seeded");

  // EP-STORE-OPS: Unified Hours of Operation Setup
  const epicOps = await prisma.epic.upsert({
    where: { epicId: "EP-STORE-OPS" },
    update: {
      title: "Unified Hours of Operation Setup",
      description:
        "Dedicated operating hours step in the onboarding flow (after org-settings, before storefront). " +
        "Captures business operating schedule once, feeds both BusinessProfile (deployment windows) and " +
        "ProviderAvailability (storefront booking). Smart defaults from archetype/industry. " +
        "Reusable hours editor component for post-setup changes. " +
        "Spec: docs/superpowers/specs/2026-03-22-unified-hours-of-operation-design.md",
    },
    create: {
      epicId: "EP-STORE-OPS",
      title: "Unified Hours of Operation Setup",
      description:
        "Dedicated operating hours step in the onboarding flow (after org-settings, before storefront). " +
        "Captures business operating schedule once, feeds both BusinessProfile (deployment windows) and " +
        "ProviderAvailability (storefront booking). Smart defaults from archetype/industry. " +
        "Reusable hours editor component for post-setup changes. " +
        "Spec: docs/superpowers/specs/2026-03-22-unified-hours-of-operation-design.md",
      status: "open",
    },
  });

  // Link to both portfolios — storefront (booking) + foundational (deployment windows)
  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: epicOps.id, portfolioId: storefront.id } },
    update: {},
    create: { epicId: epicOps.id, portfolioId: storefront.id },
  });
  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: epicOps.id, portfolioId: foundational.id } },
    update: {},
    create: { epicId: epicOps.id, portfolioId: foundational.id },
  });

  // EP-STORE-SCHED: Recurring Class/Session Scheduling
  const epicSched = await prisma.epic.upsert({
    where: { epicId: "EP-STORE-SCHED" },
    update: {
      title: "Recurring Class/Session Scheduling",
      description:
        "Timetable builder for training academies, yoga studios, fitness classes, and other " +
        "class-based businesses. Recurring sessions within operating hours, capacity per session, " +
        "enrollment/waitlists, instructor assignment, auto-generation of future instances. " +
        "Depends on EP-STORE-OPS delivering the operating hours foundation. " +
        "Architecturally distinct from appointment-based booking (1:many with capacity constraints).",
    },
    create: {
      epicId: "EP-STORE-SCHED",
      title: "Recurring Class/Session Scheduling",
      description:
        "Timetable builder for training academies, yoga studios, fitness classes, and other " +
        "class-based businesses. Recurring sessions within operating hours, capacity per session, " +
        "enrollment/waitlists, instructor assignment, auto-generation of future instances. " +
        "Depends on EP-STORE-OPS delivering the operating hours foundation. " +
        "Architecturally distinct from appointment-based booking (1:many with capacity constraints).",
      status: "open",
    },
  });

  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: epicSched.id, portfolioId: storefront.id } },
    update: {},
    create: { epicId: epicSched.id, portfolioId: storefront.id },
  });

  console.log(`Seeded ${epicOps.epicId}: "${epicOps.title}" -> products_and_services_sold + foundational`);
  console.log(`Seeded ${epicSched.epicId}: "${epicSched.title}" -> products_and_services_sold`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
