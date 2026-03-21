// One-off: Update EP-CHG-MGMT backlog items to reflect implementation progress
// Run: pnpm --filter @dpf/db exec tsx scripts/update-chg-mgmt-progress.ts
import { prisma } from "../src/client";

async function main() {
  // Find EP-CHG-MGMT epic
  const epic = await prisma.epic.findFirst({
    where: { epicId: "EP-CHG-MGMT" },
    include: { items: { orderBy: { priority: "asc" } } },
  });

  if (!epic) {
    console.log("EP-CHG-MGMT epic not found");
    return;
  }

  console.log(`Epic: ${epic.epicId} — ${epic.title} (${epic.status})`);
  console.log(`Backlog items: ${epic.items.length}`);

  // Mark epic as in-progress
  await prisma.epic.update({
    where: { id: epic.id },
    data: { status: "in-progress" },
  });
  console.log("  ✅ Epic status → in-progress");

  // Items completed (phases 1, 2, 4, 6 + execution + API + integration)
  const doneItemIds = [
    "EP-CHG-MGMT-001", // ChangeRequest and ChangeItem schema
    "EP-CHG-MGMT-002", // BusinessProfile model
    "EP-CHG-MGMT-003", // DeploymentWindow model
    "EP-CHG-MGMT-004", // BlackoutPeriod model
    "EP-CHG-MGMT-005", // RFC lifecycle state machine
    "EP-CHG-MGMT-006", // Emergency change expedited path
    "EP-CHG-MGMT-007", // ChangeItem types
    "EP-CHG-MGMT-009", // Risk level auto-calculation
    "EP-CHG-MGMT-010", // Deployment window calculation engine
    "EP-CHG-MGMT-014", // Post-change health probe verification
    "EP-CHG-MGMT-016", // /ops/changes route
    "EP-CHG-MGMT-017", // RFC detail view
    "EP-CHG-MGMT-018", // Business profile and deployment window config UI
  ];

  // Items deferred (blocked on dependencies)
  const deferredItemIds = [
    "EP-CHG-MGMT-008", // Auto impact assessment (needs EP-FOUND-OPS)
    "EP-CHG-MGMT-011", // CalendarEvent creation (needs system-ownership resolution)
    "EP-CHG-MGMT-012", // Booking block during maintenance (needs CalendarEvent)
    "EP-CHG-MGMT-013", // Platform status banner API
    "EP-CHG-MGMT-015", // StandardChangeCatalog model UI
  ];

  for (const itemId of doneItemIds) {
    const result = await prisma.backlogItem.updateMany({
      where: { itemId, status: { not: "done" } },
      data: { status: "done", completedAt: new Date() },
    });
    if (result.count > 0) console.log(`  ✅ ${itemId} → done`);
  }

  for (const itemId of deferredItemIds) {
    const result = await prisma.backlogItem.updateMany({
      where: { itemId, status: { not: "deferred" } },
      data: { status: "deferred" },
    });
    if (result.count > 0) console.log(`  ⏸️  ${itemId} → deferred`);
  }

  // Summary
  const updated = await prisma.epic.findFirst({
    where: { epicId: "EP-CHG-MGMT" },
    include: {
      items: {
        orderBy: { priority: "asc" },
        select: { itemId: true, status: true, title: true },
      },
    },
  });

  console.log("\n--- Final Status ---");
  const byStatus: Record<string, number> = {};
  for (const item of updated!.items) {
    byStatus[item.status] = (byStatus[item.status] || 0) + 1;
    console.log(`  ${item.status.padEnd(10)} ${item.itemId} ${item.title.substring(0, 60)}`);
  }
  console.log("\nSummary:", byStatus);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
