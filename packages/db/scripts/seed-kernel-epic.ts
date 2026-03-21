import { prisma } from "../src/client";

async function main() {
  const foundational = await prisma.portfolio.findUnique({ where: { slug: "foundational" } });
  if (!foundational) throw new Error("foundational portfolio not seeded");

  const epic = await prisma.epic.upsert({
    where: { epicId: "EP-KERNEL-001" },
    update: {
      title: "Trusted AI Kernel — Model Aptitude Assessment & Capability Badging",
      description:
        "AI models profiled like people — aptitude assessments that reveal personality, strengths, " +
        "and best-fit roles. Minimum capability badges to function in a role. Specialty recognition " +
        "for purpose-trained models (Hugging Face ecosystem). Models must REFUSE tasks beyond their " +
        "certified capabilities — say no, don't hallucinate. Team composition logic assembles diverse " +
        "model teams for complex tasks (Scott Page cognitive diversity framework). Ties to Trusted AI " +
        "Kernel trust lifecycle (Learning→Practicing→Innate). Current state: naked models with no " +
        "guardrails produce trial-and-error chaos — inflated eval scores, routing to incapable models, " +
        "no explanation of why a model was chosen or what it can't do.",
    },
    create: {
      epicId: "EP-KERNEL-001",
      title: "Trusted AI Kernel — Model Aptitude Assessment & Capability Badging",
      description:
        "AI models profiled like people — aptitude assessments that reveal personality, strengths, " +
        "and best-fit roles. Minimum capability badges to function in a role. Specialty recognition " +
        "for purpose-trained models (Hugging Face ecosystem). Models must REFUSE tasks beyond their " +
        "certified capabilities — say no, don't hallucinate. Team composition logic assembles diverse " +
        "model teams for complex tasks (Scott Page cognitive diversity framework). Ties to Trusted AI " +
        "Kernel trust lifecycle (Learning→Practicing→Innate). Current state: naked models with no " +
        "guardrails produce trial-and-error chaos — inflated eval scores, routing to incapable models, " +
        "no explanation of why a model was chosen or what it can't do.",
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
