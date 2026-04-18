// apps/web/scripts/hive-scout-manual-run.ts
//
// Local-dev runner for the Hive Scout. Seeds the new skill + prompt, invokes
// the ingestion action, then invokes it again to confirm idempotence.
//
// Usage (from repo root, with local postgres on localhost:5432):
//   DATABASE_URL=postgresql://dpf:PASS@localhost:5432/dpf \
//     pnpm --filter web exec tsx scripts/hive-scout-manual-run.ts
//
// This is a development-time helper only; it is not shipped or wired into
// any scheduled path. The durable scheduler lives in
// apps/web/lib/queue/functions/hive-scout-ingest.ts.

import { prisma } from "@dpf/db";
import { seedSkills } from "../../../packages/db/src/seed-skills";
import { seedPromptTemplates } from "../../../packages/db/src/seed-prompt-templates";
import { runHiveScoutIngest } from "../lib/actions/hive-scout/ingest-500-agents";

async function main() {
  console.log("[hive-scout] seeding skills...");
  await seedSkills(prisma as never);

  console.log("[hive-scout] seeding prompt templates...");
  await seedPromptTemplates(prisma as never);

  console.log("[hive-scout] first run...");
  const first = await runHiveScoutIngest();
  console.log("FIRST RUN:", first);

  console.log("[hive-scout] second run (expect 0 new created)...");
  const second = await runHiveScoutIngest();
  console.log("SECOND RUN:", second);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[hive-scout] run failed:", err);
  process.exit(1);
});
