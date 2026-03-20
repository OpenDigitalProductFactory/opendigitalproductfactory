// One-off script: seed the EP-UX-001 Light Mode UX Theme epic
// Run from repo root: pnpm --filter @dpf/db exec tsx scripts/seed-ux-theme-epic.ts
import { prisma } from "../src/client";

const EPIC_ID = "EP-UX-001";

async function main() {
  // Idempotent: skip if already exists
  const existing = await prisma.epic.findUnique({
    where: { epicId: EPIC_ID },
  });

  if (existing) {
    console.log(`Epic ${EPIC_ID} already exists (id: ${existing.id}). Skipping.`);
    return;
  }

  const epic = await prisma.epic.create({
    data: {
      epicId:      EPIC_ID,
      title:       "EP-UX-001: Light Mode UX Theme",
      description: "Add light mode support driven by OS prefers-color-scheme with WCAG AA contrast enforcement, dual palette derivation, and accessibility policy.",
      status:      "in-progress",
    },
  });

  console.log(`Created epic ${epic.epicId} (id: ${epic.id})`);
  console.log("Done.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
