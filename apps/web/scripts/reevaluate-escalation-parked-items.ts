// apps/web/scripts/reevaluate-escalation-parked-items.ts
//
// One-time, idempotent re-evaluation of backlog items stranded behind build
// escalations that have already resolved (BI-5BF1D4D0, EP-8717D32C).
//
// It runs the same code path the 15-minute escalation hygiene sweep now runs
// (reconcileEscalationParkedItems), so there are no hand-written SQL writes. Each
// re-opened or re-deferred item gets a status_change activity row. A second run
// finds nothing to do.
//
// Run via:
//   pnpm --filter web exec tsx scripts/reevaluate-escalation-parked-items.ts --dry-run
//   pnpm --filter web exec tsx scripts/reevaluate-escalation-parked-items.ts
//
// Exit code 1 when orphans remain after a real run (the AC-1 invariant fails).

import { prisma } from "@dpf/db";
import {
  countEscalationParkedOrphans,
  reconcileEscalationParkedItems,
} from "../lib/backlog/escalation-parked-return";

async function main(): Promise<number> {
  const dryRun = process.argv.includes("--dry-run");
  const before = await countEscalationParkedOrphans();
  const result = await reconcileEscalationParkedItems({ dryRun });
  const after = dryRun ? before : await countEscalationParkedOrphans();
  console.log(
    JSON.stringify({ dryRun, orphansBefore: before, ...result, orphansAfter: after }, null, 2),
  );
  return !dryRun && after > 0 ? 1 : 0;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(2);
  });
