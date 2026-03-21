import { prisma } from "../src/client";

async function main() {
  const foundational = await prisma.portfolio.findUnique({ where: { slug: "foundational" } });
  if (!foundational) throw new Error("foundational portfolio not seeded");

  const epic = await prisma.epic.upsert({
    where: { epicId: "EP-UX-PERSONA-001" },
    update: {
      title: "AI Agent Personality Preferences — Per-User Tone & Style",
      description:
        "Each user can set their preferred AI coworker personality within org-defined boundaries. " +
        "Configured during initial user onboarding and adjustable in user settings. Options like " +
        "formal/casual, concise/detailed, proactive/reactive. Organization admin sets guardrails " +
        "(e.g., always professional, no humor) — user preferences work within those bounds. " +
        "Applies across all agent interactions for that user. Corporate solution so personality " +
        "stays appropriate but adapts to individual work style.",
    },
    create: {
      epicId: "EP-UX-PERSONA-001",
      title: "AI Agent Personality Preferences — Per-User Tone & Style",
      description:
        "Each user can set their preferred AI coworker personality within org-defined boundaries. " +
        "Configured during initial user onboarding and adjustable in user settings. Options like " +
        "formal/casual, concise/detailed, proactive/reactive. Organization admin sets guardrails " +
        "(e.g., always professional, no humor) — user preferences work within those bounds. " +
        "Applies across all agent interactions for that user. Corporate solution so personality " +
        "stays appropriate but adapts to individual work style.",
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
