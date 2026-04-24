/**
 * EP-REG-DORA-001: Create backlog items for gaps found during DORA dogfood.
 * Run: cd packages/db && npx tsx scripts/seed-dora-backlog.ts
 */
import { PrismaClient } from "../generated/client/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as crypto from "crypto";
import { loadDbEnv } from "../src/load-env";

loadDbEnv();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function makeItemId(): string {
  const hex = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `BLI-${hex}`;
}

const PRIORITY_MAP: Record<string, number> = { high: 1, medium: 2, low: 3 };

const BACKLOG_ITEMS = [
  {
    title: "Compliance: Add create forms for evidence, risks, incidents, audits, corrective actions, submissions",
    body:
      "6 entity types have `create*` server actions but no UI forms. Found during DORA dogfood (EP-REG-DORA-001). " +
      "Users cannot create these records through the web interface. Follow CreateObligationForm/CreateControlForm patterns.",
    priority: "high",
    source: "EP-REG-DORA-001",
  },
  {
    title: "Compliance: Add edit capability for all compliance entities",
    body:
      "All compliance entity types have `update*` server actions but no edit UI. Found during DORA dogfood. " +
      "Zero records can be edited through the web interface.",
    priority: "high",
    source: "EP-REG-DORA-001",
  },
  {
    title: "Compliance: Add control-obligation linking UI",
    body:
      "The `linkControlToObligation` and `unlinkControlFromObligation` server actions exist but have no UI. " +
      "This is the core workflow for building compliance coverage — without it, customers can't connect " +
      "controls to obligations through the UI. Found during DORA dogfood. " +
      "Add linking UI to obligation detail page and control detail page.",
    priority: "high",
    source: "EP-REG-DORA-001",
  },
  {
    title: "Compliance: Add detail pages for incidents, evidence, risks, corrective actions",
    body:
      "4 entity types have `get*` server actions returning full detail data but no detail page UI. " +
      "Found during DORA dogfood. Follow patterns from obligation/control detail pages.",
    priority: "medium",
    source: "EP-REG-DORA-001",
  },
  {
    title: "Compliance: Add risk-control linking UI",
    body:
      "The `linkRiskToControl` and `unlinkRiskFromControl` server actions exist but have no UI. " +
      "Found during DORA dogfood.",
    priority: "medium",
    source: "EP-REG-DORA-001",
  },
  {
    title: "Compliance: Add filters to remaining list pages (evidence, risks, incidents, audits, actions, submissions)",
    body:
      "All list server actions support filter parameters but 6 pages don't expose filter controls. " +
      "Follow patterns from obligations/controls filter bars. Found during DORA dogfood.",
    priority: "medium",
    source: "EP-REG-DORA-001",
  },
  {
    title: "Compliance: Add bulk import for obligations",
    body:
      "Creating 40+ obligations one by one via UI forms is painful for regulation onboarding. " +
      "Need CSV/JSON import or paste-from-spreadsheet capability. Found during DORA dogfood.",
    priority: "medium",
    source: "EP-REG-DORA-001",
  },
  {
    title: "Compliance: Fix form error display — show server-side errors to user",
    body:
      "CreateRegulationForm and CreatePolicyForm check `result.ok` but never display the error message. " +
      "Found during DORA dogfood.",
    priority: "low",
    source: "EP-REG-DORA-001",
  },
  {
    title: "Compliance: Add breadcrumb navigation to detail pages",
    body:
      "Regulation, audit, policy, obligation, control, and submission detail pages have no back links " +
      "or breadcrumbs to their parent list pages. Found during DORA dogfood.",
    priority: "low",
    source: "EP-REG-DORA-001",
  },
  {
    title: "Compliance: Fix policy detail — obligation link goes to list instead of detail",
    body:
      "The obligation link on the policy detail page navigates to `/compliance/obligations` (list) " +
      "instead of `/compliance/obligations/[id]` (specific obligation detail). Found during DORA dogfood.",
    priority: "low",
    source: "EP-REG-DORA-001",
  },
];

async function main() {
  console.log("Creating backlog items for DORA dogfood gaps...\n");

  // Find the GRC epic
  const grcEpic = await prisma.epic.findFirst({
    where: {
      OR: [
        { title: { contains: "Compliance" } },
        { title: { contains: "GRC" } },
      ],
      status: "active",
    },
  });

  let created = 0;
  let skipped = 0;

  for (const item of BACKLOG_ITEMS) {
    const existing = await prisma.backlogItem.findFirst({
      where: { title: item.title },
    });

    if (existing) {
      skipped++;
      continue;
    }

    await prisma.backlogItem.create({
      data: {
        itemId: makeItemId(),
        title: item.title,
        body: item.body,
        type: "product",
        priority: PRIORITY_MAP[item.priority] ?? 2,
        status: "open",
        source: item.source,
        epicId: grcEpic?.id ?? null,
      },
    });
    created++;
  }

  console.log(`Created: ${created}, Skipped (existing): ${skipped}`);
  console.log("Done.\n");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
