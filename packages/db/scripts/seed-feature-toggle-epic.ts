import { prisma } from "../src/client";

async function main() {
  const foundational = await prisma.portfolio.findUnique({ where: { slug: "foundational" } });
  if (!foundational) throw new Error("foundational portfolio not seeded");

  const epic = await prisma.epic.upsert({
    where: { epicId: "EP-ADMIN-001" },
    update: {
      title: "Feature Toggle — Enable/Disable Platform Capabilities",
      description:
        "Admin-level enable/disable toggles for major platform features (Storefront, Compliance, " +
        "Finance, Build Studio, EA Modeler, etc.). Not every business needs every feature — disabled " +
        "features hide from navigation, workspace tiles, and agent routing. Reduces complexity for " +
        "users who only need a subset of the platform. Should be configurable during onboarding " +
        "and from Admin > Settings.",
    },
    create: {
      epicId: "EP-ADMIN-001",
      title: "Feature Toggle — Enable/Disable Platform Capabilities",
      description:
        "Admin-level enable/disable toggles for major platform features (Storefront, Compliance, " +
        "Finance, Build Studio, EA Modeler, etc.). Not every business needs every feature — disabled " +
        "features hide from navigation, workspace tiles, and agent routing. Reduces complexity for " +
        "users who only need a subset of the platform. Should be configurable during onboarding " +
        "and from Admin > Settings.",
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
