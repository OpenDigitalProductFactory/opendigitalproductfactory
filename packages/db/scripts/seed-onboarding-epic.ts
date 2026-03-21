// One-off script: seed the onboarding epics (EP-ONBOARD-001, EP-ONBOARD-002)
// Run from repo root: pnpm --filter @dpf/db exec tsx scripts/seed-onboarding-epic.ts
import { prisma } from "../src/client";

async function main() {
  const foundational = await prisma.portfolio.findUnique({ where: { slug: "foundational" } });
  if (!foundational) throw new Error("foundational portfolio not seeded");

  const epic1 = await prisma.epic.upsert({
    where: { epicId: "EP-ONBOARD-001" },
    update: {
      title: "COO-Led Platform Onboarding",
      description:
        "AI Coworker-led setup experience where the COO persona guides non-technical users " +
        "through initial platform configuration. Ollama auto-bootstraps on first launch. " +
        "Spec: docs/superpowers/specs/2026-03-21-coo-led-onboarding-design.md",
    },
    create: {
      epicId: "EP-ONBOARD-001",
      title: "COO-Led Platform Onboarding",
      description:
        "AI Coworker-led setup experience where the COO persona guides non-technical users " +
        "through initial platform configuration. Ollama auto-bootstraps on first launch. " +
        "Spec: docs/superpowers/specs/2026-03-21-coo-led-onboarding-design.md",
      status: "open",
    },
  });

  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: epic1.id, portfolioId: foundational.id } },
    update: {},
    create: { epicId: epic1.id, portfolioId: foundational.id },
  });

  const epic2 = await prisma.epic.upsert({
    where: { epicId: "EP-ONBOARD-002" },
    update: {
      title: "Platform Extensibility Demo (Onboarding)",
      description:
        "Guided walkthrough of Build Studio self-development during onboarding. " +
        "Parked until the self-dev pipeline is production-ready.",
    },
    create: {
      epicId: "EP-ONBOARD-002",
      title: "Platform Extensibility Demo (Onboarding)",
      description:
        "Guided walkthrough of Build Studio self-development during onboarding. " +
        "Parked until the self-dev pipeline is production-ready.",
      status: "open",
    },
  });

  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: epic2.id, portfolioId: foundational.id } },
    update: {},
    create: { epicId: epic2.id, portfolioId: foundational.id },
  });

  console.log(`Seeded ${epic1.epicId}: "${epic1.title}" -> foundational portfolio`);
  console.log(`Seeded ${epic2.epicId}: "${epic2.title}" -> foundational portfolio`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
