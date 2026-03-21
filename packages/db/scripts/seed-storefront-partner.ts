import { prisma } from "../src/client";

async function main() {
  const foundational = await prisma.portfolio.findUnique({ where: { slug: "foundational" } });
  if (!foundational) throw new Error("foundational portfolio not seeded");

  // Storefront onboarding backlog item
  const bli = await prisma.backlogItem.create({
    data: {
      itemId: `BLI-${Date.now().toString(36).toUpperCase()}`,
      title: "Add Storefront step to onboarding tour",
      body:
        "Storefront configuration should be part of the setup tour — where owners configure " +
        "customer access to the platform. Login behavior and welcome page should adapt based " +
        "on whether storefront is enabled (ties to EP-ADMIN-001 feature toggles).",
      status: "open",
      priority: 2,
      type: "improvement",
    },
  });
  console.log(`Created: ${bli.itemId} — ${bli.title}`);

  // Partners epic
  const epic = await prisma.epic.upsert({
    where: { epicId: "EP-PARTNER-001" },
    update: {
      title: "Partner Access — Third-Party Collaboration Model",
      description:
        "Many organizations have partners that are neither customers nor employees — suppliers, " +
        "distributors, consultants, agencies, affiliates. They need controlled platform access " +
        "with different permissions, visibility, and data boundaries than customers or employees. " +
        "Needs its own access model, portal experience, and role hierarchy.",
    },
    create: {
      epicId: "EP-PARTNER-001",
      title: "Partner Access — Third-Party Collaboration Model",
      description:
        "Many organizations have partners that are neither customers nor employees — suppliers, " +
        "distributors, consultants, agencies, affiliates. They need controlled platform access " +
        "with different permissions, visibility, and data boundaries than customers or employees. " +
        "Needs its own access model, portal experience, and role hierarchy.",
      status: "open",
    },
  });

  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: epic.id, portfolioId: foundational.id } },
    update: {},
    create: { epicId: epic.id, portfolioId: foundational.id },
  });

  console.log(`Seeded ${epic.epicId}: "${epic.title}" → foundational portfolio`);
  await prisma.$disconnect();
}

main().catch(console.error);
