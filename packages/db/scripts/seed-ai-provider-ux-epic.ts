// Seed EP-AI-UX: AI Provider UX Refactor epic
import { prisma } from "../src/client";

async function main() {
  const foundational = await prisma.portfolio.findUnique({ where: { slug: "foundational" } });
  if (!foundational) throw new Error("foundational portfolio not seeded");

  const epic = await prisma.epic.upsert({
    where: { epicId: "EP-AI-UX" },
    update: {
      title: "AI Provider Configuration UX Refactor",
      description:
        "Simplify the AI provider configuration experience. The current UI has grown organically " +
        "with many sections (model families, discovered models, model profiles, test/sync buttons) " +
        "that made sense incrementally but now create unnecessary complexity. Key issues:\n" +
        "- Model family enable/disable toggles are unnecessary friction — if a provider is connected, its models should just work\n" +
        "- Discovered models vs model profiles distinction is confusing to non-technical users\n" +
        "- The provider detail page has too many sections for what should be a simple connect/disconnect flow\n" +
        "- ChatGPT and Codex share OAuth but show as separate providers — needs clearer UX relationship\n" +
        "- Provider status badges and test/sync workflow could be simplified\n\n" +
        "Goal: Connect a provider in one click, models are automatically available. " +
        "Advanced model configuration available through the AI coworker, not raw forms.",
    },
    create: {
      epicId: "EP-AI-UX",
      title: "AI Provider Configuration UX Refactor",
      description:
        "Simplify the AI provider configuration experience. The current UI has grown organically " +
        "with many sections (model families, discovered models, model profiles, test/sync buttons) " +
        "that made sense incrementally but now create unnecessary complexity. Key issues:\n" +
        "- Model family enable/disable toggles are unnecessary friction — if a provider is connected, its models should just work\n" +
        "- Discovered models vs model profiles distinction is confusing to non-technical users\n" +
        "- The provider detail page has too many sections for what should be a simple connect/disconnect flow\n" +
        "- ChatGPT and Codex share OAuth but show as separate providers — needs clearer UX relationship\n" +
        "- Provider status badges and test/sync workflow could be simplified\n\n" +
        "Goal: Connect a provider in one click, models are automatically available. " +
        "Advanced model configuration available through the AI coworker, not raw forms.",
      status: "open",
    },
  });

  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: epic.id, portfolioId: foundational.id } },
    update: {},
    create: { epicId: epic.id, portfolioId: foundational.id },
  });

  console.log(`Seeded ${epic.epicId}: "${epic.title}"`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
