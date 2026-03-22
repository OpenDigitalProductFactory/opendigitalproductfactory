// One-off script: seed NVIDIA integration + auth hardening epics
// Run from repo root: pnpm --filter @dpf/db exec tsx scripts/seed-nvidia-epics.ts
import { prisma } from "../src/client";

const epics = [
  {
    epicId: "EP-INF-011",
    title: "NVIDIA Model Provider Integration",
    description:
      "Cloud API (build.nvidia.com) + local NIM provider integration. Dual-provider " +
      "architecture (nvidia-cloud, nvidia-nim) with unified admin facade. Full catalog " +
      "discovery, automatic profiling, sensitivity-driven routing. Local NIM for " +
      "confidential/restricted data, cloud for general use. OpenAI-compatible API " +
      "means no new execution adapter. Generalizes local_only residency check beyond Ollama.",
    status: "backlog",
  },
  {
    epicId: "EP-AUTH-002",
    title: "Provider Authentication Layer Hardening",
    description:
      "Audit all provider auth methods and requirements. Extensible auth adapter pattern " +
      "with per-provider typed handlers for validation, token refresh, and error classification. " +
      "Fix current pain points in Anthropic API key and OAuth flows. Standardize credential " +
      "validation at configuration time. Improve auth error UX. Prepares for Azure OpenAI, " +
      "Vertex AI, and enterprise SSO provider auth.",
    status: "backlog",
  },
];

async function main() {
  for (const def of epics) {
    const epic = await prisma.epic.upsert({
      where: { epicId: def.epicId },
      create: {
        epicId: def.epicId,
        title: def.title,
        description: def.description,
        status: def.status,
      },
      update: {
        title: def.title,
        description: def.description,
        status: def.status,
      },
    });
    console.log(`  ${epic.epicId}: ${epic.title} → ${epic.status}`);
  }

  // Link epics to the foundational portfolio if it exists
  const foundational = await prisma.portfolio.findUnique({
    where: { slug: "foundational" },
  });
  if (foundational) {
    for (const def of epics) {
      const epic = await prisma.epic.findUnique({ where: { epicId: def.epicId } });
      if (!epic) continue;
      await prisma.epicPortfolio.upsert({
        where: {
          epicId_portfolioId: { epicId: epic.id, portfolioId: foundational.id },
        },
        create: { epicId: epic.id, portfolioId: foundational.id },
        update: {},
      });
    }
    console.log(`\nLinked epics to foundational portfolio.`);
  }

  console.log("\nDone. NVIDIA + auth hardening epics seeded.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
