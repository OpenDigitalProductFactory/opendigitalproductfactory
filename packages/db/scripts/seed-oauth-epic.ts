// One-off script: seed the OAuth authorization code epic (EP-OAUTH-001)
// Run from repo root: pnpm --filter @dpf/db exec tsx scripts/seed-oauth-epic.ts
import { prisma } from "../src/client";

async function main() {
  const foundational = await prisma.portfolio.findUnique({ where: { slug: "foundational" } });
  if (!foundational) throw new Error("foundational portfolio not seeded");

  const epic = await prisma.epic.upsert({
    where: { epicId: "EP-OAUTH-001" },
    update: {
      title: "Generic OAuth Authorization Code Flow for AI Providers",
      description:
        "Add OAuth 2.0 authorization code + PKCE as a generic auth method for AI providers. " +
        "Admin-initiated browser sign-in stores encrypted access + refresh tokens platform-wide. " +
        "Data-driven: providers declare authorizeUrl, tokenUrl, oauthClientId in registry. " +
        "OpenAI Codex is the first consumer (ChatGPT subscription access). " +
        "Spec: docs/superpowers/specs/2026-03-21-provider-oauth-authorization-code-design.md",
    },
    create: {
      epicId: "EP-OAUTH-001",
      title: "Generic OAuth Authorization Code Flow for AI Providers",
      description:
        "Add OAuth 2.0 authorization code + PKCE as a generic auth method for AI providers. " +
        "Admin-initiated browser sign-in stores encrypted access + refresh tokens platform-wide. " +
        "Data-driven: providers declare authorizeUrl, tokenUrl, oauthClientId in registry. " +
        "OpenAI Codex is the first consumer (ChatGPT subscription access). " +
        "Spec: docs/superpowers/specs/2026-03-21-provider-oauth-authorization-code-design.md",
      status: "open",
    },
  });

  // Link to foundational portfolio
  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: epic.id, portfolioId: foundational.id } },
    update: {},
    create: { epicId: epic.id, portfolioId: foundational.id },
  });

  console.log(`Seeded epic ${epic.epicId}: "${epic.title}" → foundational portfolio`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
