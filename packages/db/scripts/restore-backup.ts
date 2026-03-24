/**
 * Restore epics and backlog items from JSON backup files.
 *
 * Usage: pnpm --filter @dpf/db exec tsx scripts/restore-backup.ts [backup-dir]
 * Default backup dir: h:/backups
 *
 * Handles the mapping between old internal IDs (from backup) and new internal IDs
 * by resolving references through business keys (epicId, itemId).
 */
import { prisma } from "../src/client";
import { readFileSync } from "fs";
import { resolve } from "path";

const backupDir = process.argv[2] || "h:/backups";

// ── Old internal epic ID → epicId (business key) mapping ─────────────────────
// Built by cross-referencing backlog item prefixes with epic names
const OLD_EPIC_ID_TO_EPIC_ID: Record<string, string> = {
  "cmn14a86x08334co79il8sdg1": "EP-UI-THEME-001",
  "cmn14a8at08344co7lz9f22cc": "EP-UI-A11Y-001",
  "cmn14a8ch083a4co7vjm2iqfy": "EP-LLM-LIVE-001",
  "cmn14a8d0083g4co7al6zw241": "EP-DEPLOY-001",
  "cmn14a8di083n4co7hu6es2pm": "EP-AGENT-EXEC-001",
  "cmn14a8e3083u4co7t1ph5k8v": "EP-REST-API-001",
  "cmn14a8ff084c4co7fngwt40p": "EP-MOBILE-FOUND-001",
  "cmn14a8gb084n4co7m6ht7r0d": "EP-MOBILE-FEAT-001",
  "cmn14a8h5084z4co7kjfg09km": "EP-MOBILE-DYN-001",
  "7a5be275-150f-431e-8192-7bc570c64f38": "EP-PROD-BUILD-001",
  "207443fc-5596-47af-8d4e-54635f35fca6": "EP-DMR-001",
  "e47ba91c-72d9-415a-8a54-dcd2ba5de499": "EP-DEVCONTAINER-001",
  "6b77dc9a-06a9-4b8f-99ce-5d2c953dda3d": "EP-TASK-GOV-001",
  "ecea030e-9d13-4e8b-9cd6-3eedcd10b489": "EP-SPEC-001",
  "6fb4261e-85ff-4150-a120-9734a483eead": "EP-COLL-001",
};

// ── Old portfolio internal ID → slug mapping ─────────────────────────────────
const OLD_PORTFOLIO_TO_SLUG: Record<string, string> = {
  "cmn14a7g907l34co7dgwng3oc": "foundational",
  "cmn14a7gd07l44co7qex4gpno": "manufacturing_and_delivery",
  "cmn14a7gf07l64co7ydvt0c6m": "products_and_services_sold",
};

interface BackupEpic {
  epicId: string;
  title: string;
  description: string | null;
  status: string;
  agentId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface BackupItem {
  itemId: string;
  title: string;
  body: string | null;
  status: string;
  type: string;
  priority: number | null;
  epicId: string | null;
  agentId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface BackupPortfolioLink {
  epicId: string;
  portfolioId: string;
}

function readBackup<T>(filename: string): T {
  return JSON.parse(readFileSync(resolve(backupDir, filename), "utf-8")) as T;
}

async function main() {
  console.log(`Reading backup from ${backupDir}...`);
  const epics = readBackup<BackupEpic[]>("epics.json");
  const items = readBackup<BackupItem[]>("backlog-items.json");
  const portfolioLinks = readBackup<BackupPortfolioLink[]>("epic-portfolios.json");

  console.log(`  ${epics.length} epics, ${items.length} backlog items, ${portfolioLinks.length} portfolio links`);

  // ── Step 1: Upsert all epics ─────────────────────────────────────────────
  console.log("\n=== Restoring epics ===");
  let epicCreated = 0, epicUpdated = 0;
  for (const e of epics) {
    const existing = await prisma.epic.findUnique({ where: { epicId: e.epicId } });
    if (existing) {
      await prisma.epic.update({
        where: { epicId: e.epicId },
        data: {
          title: e.title,
          description: e.description,
          status: e.status,
          createdAt: new Date(e.createdAt),
          updatedAt: new Date(e.updatedAt),
          completedAt: e.completedAt ? new Date(e.completedAt) : null,
        },
      });
      epicUpdated++;
    } else {
      await prisma.epic.create({
        data: {
          epicId: e.epicId,
          title: e.title,
          description: e.description,
          status: e.status,
          createdAt: new Date(e.createdAt),
          updatedAt: new Date(e.updatedAt),
          completedAt: e.completedAt ? new Date(e.completedAt) : null,
        },
      });
      epicCreated++;
    }
  }
  console.log(`  Created ${epicCreated}, updated ${epicUpdated}`);

  // ── Build epicId → new internal ID lookup ────────────────────────────────
  const allEpics = await prisma.epic.findMany({ select: { id: true, epicId: true } });
  const epicIdToInternal = new Map(allEpics.map((e) => [e.epicId, e.id]));

  // ── Step 2: Upsert all backlog items ─────────────────────────────────────
  console.log("\n=== Restoring backlog items ===");
  let itemCreated = 0, itemUpdated = 0, itemLinked = 0, itemUnlinked = 0;
  for (const i of items) {
    // Resolve old epic internal ID → epicId → new internal ID
    let resolvedEpicId: string | null = null;
    if (i.epicId) {
      const epicBusinessKey = OLD_EPIC_ID_TO_EPIC_ID[i.epicId];
      if (epicBusinessKey) {
        resolvedEpicId = epicIdToInternal.get(epicBusinessKey) ?? null;
        if (resolvedEpicId) itemLinked++;
        else itemUnlinked++;
      } else {
        // Check if the epicId is already a business key or current internal ID
        resolvedEpicId = epicIdToInternal.get(i.epicId) ?? null;
        if (!resolvedEpicId) {
          // Check if it matches an existing internal ID directly
          const direct = allEpics.find((e) => e.id === i.epicId);
          resolvedEpicId = direct?.id ?? null;
        }
        if (resolvedEpicId) itemLinked++;
        else {
          console.warn(`  WARNING: Could not resolve epicId "${i.epicId}" for item ${i.itemId}`);
          itemUnlinked++;
        }
      }
    }

    const data = {
      title: i.title,
      body: i.body,
      status: i.status,
      type: i.type,
      priority: i.priority,
      epicId: resolvedEpicId,
      createdAt: new Date(i.createdAt),
      updatedAt: new Date(i.updatedAt),
      completedAt: i.completedAt ? new Date(i.completedAt) : null,
    };

    const existing = await prisma.backlogItem.findUnique({ where: { itemId: i.itemId } });
    if (existing) {
      await prisma.backlogItem.update({ where: { itemId: i.itemId }, data });
      itemUpdated++;
    } else {
      await prisma.backlogItem.create({ data: { itemId: i.itemId, ...data } });
      itemCreated++;
    }
  }
  console.log(`  Created ${itemCreated}, updated ${itemUpdated}`);
  console.log(`  Epic links: ${itemLinked} resolved, ${itemUnlinked} unresolved`);

  // ── Step 3: Restore portfolio links ──────────────────────────────────────
  console.log("\n=== Restoring portfolio links ===");
  // Get current portfolio slug → id mapping
  const portfolios = await prisma.portfolio.findMany({ select: { id: true, slug: true } });
  const portfolioSlugToId = new Map(portfolios.map((p) => [p.slug, p.id]));

  let linkCreated = 0, linkSkipped = 0;
  for (const link of portfolioLinks) {
    // Resolve old epic internal ID → epicId → new internal ID
    const epicBusinessKey = OLD_EPIC_ID_TO_EPIC_ID[link.epicId];
    const newEpicId = epicBusinessKey
      ? epicIdToInternal.get(epicBusinessKey)
      : allEpics.find((e) => e.id === link.epicId)?.id;

    // Resolve old portfolio internal ID → slug → new internal ID
    const portfolioSlug = OLD_PORTFOLIO_TO_SLUG[link.portfolioId];
    const newPortfolioId = portfolioSlug
      ? portfolioSlugToId.get(portfolioSlug)
      : portfolios.find((p) => p.id === link.portfolioId)?.id;

    if (!newEpicId || !newPortfolioId) {
      const epicNote = newEpicId ? "" : ` epic=${link.epicId}`;
      const portNote = newPortfolioId ? "" : ` portfolio=${link.portfolioId}`;
      console.warn(`  SKIP: unresolved${epicNote}${portNote}`);
      linkSkipped++;
      continue;
    }

    await prisma.epicPortfolio.upsert({
      where: { epicId_portfolioId: { epicId: newEpicId, portfolioId: newPortfolioId } },
      update: {},
      create: { epicId: newEpicId, portfolioId: newPortfolioId },
    });
    linkCreated++;
  }
  console.log(`  Created ${linkCreated}, skipped ${linkSkipped}`);

  console.log("\n=== Restore complete ===");
}

main()
  .catch((err) => {
    console.error("Restore failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
