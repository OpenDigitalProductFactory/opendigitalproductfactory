import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../packages/db/src/client";

const REPO_ROOT = join(__dirname, "..");

const TARGETS = [
  { category: "platform-identity", slug: "identity-block" },
  { category: "platform-preamble", slug: "platform-preamble" },
  { category: "route-persona", slug: "admin-assistant" },
  { category: "route-persona", slug: "build-specialist" },
  { category: "context", slug: "project-context" },
];

function readPromptBody(category: string, slug: string): string {
  const path = join(REPO_ROOT, "prompts", category, `${slug}.prompt.md`);
  const raw = readFileSync(path, "utf-8").replace(/\r\n/g, "\n");
  const match = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return (match ? match[1] : raw).trim();
}

async function main() {
  const reason = process.argv[2] ?? "Token-economy cleanup + typo fix";

  for (const { category, slug } of TARGETS) {
    const content = readPromptBody(category, slug);
    const existing = await prisma.promptTemplate.findUnique({
      where: { category_slug: { category, slug } },
    });

    if (!existing) {
      console.log(`SKIP ${category}/${slug} — template row not found (run seed first)`);
      continue;
    }

    if (existing.content.trim() === content.trim()) {
      console.log(`SKIP ${category}/${slug} — already at file content (v${existing.version})`);
      continue;
    }

    const newVersion = existing.version + 1;
    await prisma.$transaction([
      prisma.promptRevision.create({
        data: {
          templateId: existing.id,
          version: newVersion,
          content,
          changeReason: reason,
          changedBy: null,
        },
      }),
      prisma.promptTemplate.update({
        where: { id: existing.id },
        data: { content, version: newVersion, isOverridden: false },
      }),
    ]);

    console.log(`OK   ${category}/${slug} -> v${newVersion}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
