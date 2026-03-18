// Quick backlog summary — run with:
// cd packages/db && npx tsx ../../scripts/show-backlog.ts
import { prisma } from "../packages/db/src/client";

async function main() {
  const epics = await prisma.epic.findMany({
    include: {
      items: { orderBy: { priority: "asc" } },
      portfolios: { include: { portfolio: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const unassigned = await prisma.backlogItem.findMany({
    where: { epicId: null },
    orderBy: [{ type: "asc" }, { priority: "asc" }],
  });

  console.log(`\n${"═".repeat(72)}`);
  console.log(`  BACKLOG SUMMARY — ${new Date().toISOString().slice(0, 10)}`);
  console.log(`${"═".repeat(72)}\n`);

  for (const epic of epics) {
    const portfolios = epic.portfolios.map((ep) => ep.portfolio.name).join(", ");
    const done = epic.items.filter((i) => i.status === "done").length;
    const total = epic.items.length;
    console.log(`▸ [${epic.status.toUpperCase()}] ${epic.title}  (${done}/${total})  [${portfolios}]`);
    for (const item of epic.items) {
      const marker = item.status === "done" ? "✓" : item.status === "in-progress" ? "→" : " ";
      const truncated = item.title.length > 90 ? item.title.slice(0, 87) + "..." : item.title;
      console.log(`    ${marker} ${String(item.priority ?? "?").padStart(2)}. ${truncated}  [${item.type}/${item.status}]`);
    }
    console.log();
  }

  if (unassigned.length > 0) {
    console.log(`▸ UNASSIGNED (${unassigned.length} items)`);
    for (const item of unassigned) {
      const truncated = item.title.length > 90 ? item.title.slice(0, 87) + "..." : item.title;
      console.log(`      ${truncated}  [${item.type}/${item.status}]`);
    }
    console.log();
  }

  const totalItems = epics.reduce((s, e) => s + e.items.length, 0) + unassigned.length;
  const totalDone = epics.reduce((s, e) => s + e.items.filter((i) => i.status === "done").length, 0);
  console.log(`Total: ${epics.length} epics, ${totalItems} items, ${totalDone} done\n`);
}

main().catch(console.error);
