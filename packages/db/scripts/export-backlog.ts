/**
 * Export epics and backlog items to JSON for backup/re-seeding.
 *
 * Usage: pnpm --filter @dpf/db exec tsx scripts/export-backlog.ts [output-dir]
 * Default output: h:/backups
 */
import { prisma } from "../src/client";
import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";

const outputDir = process.argv[2] || "h:/backups";

async function main() {
  mkdirSync(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().slice(0, 10);

  // ── Epics ──────────────────────────────────────────────────────────────────
  const epics = await prisma.epic.findMany({
    orderBy: { epicId: "asc" },
    include: {
      portfolios: { select: { portfolioId: true } },
    },
  });

  const epicRows = epics.map((e) => ({
    epicId: e.epicId,
    title: e.title,
    description: e.description,
    status: e.status,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    completedAt: e.completedAt?.toISOString() ?? null,
    accountableEmployeeId: e.accountableEmployeeId,
    portfolioIds: e.portfolios.map((p) => p.portfolioId),
  }));

  const epicPath = resolve(outputDir, `epics-${timestamp}.json`);
  writeFileSync(epicPath, JSON.stringify(epicRows, null, 2));
  console.log(`Exported ${epicRows.length} epics → ${epicPath}`);

  // ── Backlog Items ──────────────────────────────────────────────────────────
  const items = await prisma.backlogItem.findMany({
    orderBy: [{ epicId: "asc" }, { priority: "asc" }],
  });

  const itemRows = items.map((i) => ({
    itemId: i.itemId,
    title: i.title,
    status: i.status,
    type: i.type,
    body: i.body,
    priority: i.priority,
    source: i.source,
    epicId: i.epicId,
    digitalProductId: i.digitalProductId,
    taxonomyNodeId: i.taxonomyNodeId,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
    completedAt: i.completedAt?.toISOString() ?? null,
    accountableEmployeeId: i.accountableEmployeeId,
  }));

  const itemPath = resolve(outputDir, `backlog-items-${timestamp}.json`);
  writeFileSync(itemPath, JSON.stringify(itemRows, null, 2));
  console.log(`Exported ${itemRows.length} backlog items → ${itemPath}`);

  // ── Portfolios (for context) ───────────────────────────────────────────────
  const portfolios = await prisma.portfolio.findMany({
    orderBy: { slug: "asc" },
  });

  const portfolioRows = portfolios.map((p) => ({
    portfolioId: p.slug,
    name: p.name,
    description: p.description,
  }));

  const portfolioPath = resolve(outputDir, `portfolios-${timestamp}.json`);
  writeFileSync(portfolioPath, JSON.stringify(portfolioRows, null, 2));
  console.log(`Exported ${portfolioRows.length} portfolios → ${portfolioPath}`);
}

main()
  .catch((err) => {
    console.error("Export failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
