// EP-1FABA22D · Purpose-Aware Installation and Ecosystem Productivity
// Capture this installation's backlog as reconcilable recovery bundles.
//
// The counterpart to `reconcile-backlog-bundle.ts`. Recovery could already restore
// a bundle, but nothing produced one, so work created on a development
// installation had no path off it before teardown. This closes that loop.
//
// Writes one bundle per epic (the bundle schema is single-epic), plus a manifest.
// Everything it cannot represent is listed, never silently dropped.

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  buildBacklogRecoveryBundle,
  type BacklogCaptureItemRow,
  type BacklogCaptureSkip,
} from "../src/backlog-recovery-bundle";
import { prisma } from "../src/client";

const CAPTURE_CONFIG_KEY = "installation.backlog-capture.v1";
const UNFINISHED_STATUSES = ["triaging", "open", "in-progress"] as const;

function usage(): string {
  return [
    "Usage: pnpm --filter @dpf/db backlog:capture -- --out <dir> [--all] [--no-receipt]",
    "",
    "Captures unfinished backlog work as reconcilable recovery bundles.",
    "  --out <dir>    Directory to write bundles into (required).",
    "  --all          Include done/deferred/retired items, not just unfinished work.",
    "  --no-receipt   Do not record the capture receipt in PlatformConfig.",
    "",
    "Restore a bundle with: pnpm --filter @dpf/db backlog:reconcile -- <bundle.json> --apply",
  ].join("\n");
}

function parseArgs(argv: string[]): { out: string; all: boolean; receipt: boolean } {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  const outIndex = argv.indexOf("--out");
  if (outIndex === -1 || !argv[outIndex + 1]) {
    throw new Error(`--out <dir> is required.\n\n${usage()}`);
  }
  const known = new Set(["--out", "--all", "--no-receipt"]);
  const unknown = argv.find(
    (arg, index) => arg.startsWith("-") && !known.has(arg) && index !== outIndex + 1,
  );
  if (unknown) throw new Error(`Unknown option: ${unknown}\n\n${usage()}`);
  return {
    out: resolve(process.cwd(), argv[outIndex + 1] as string),
    all: argv.includes("--all"),
    receipt: !argv.includes("--no-receipt"),
  };
}

/** Slugify an epic id into a stable, filesystem-safe bundle filename. */
function bundleFileName(epicId: string): string {
  return `${epicId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const capturedAt = new Date().toISOString();
  const statusFilter = args.all ? undefined : { in: [...UNFINISHED_STATUSES] };

  const epics = await prisma.epic.findMany({
    orderBy: { epicId: "asc" },
    select: {
      epicId: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      scopeKind: true,
      scopeRationale: true,
      createdAt: true,
      completedAt: true,
      backlogItems: {
        where: statusFilter ? { status: statusFilter } : undefined,
        orderBy: { itemId: "asc" },
        select: {
          itemId: true,
          title: true,
          body: true,
          status: true,
          type: true,
          workType: true,
          source: true,
          priority: true,
          effortSize: true,
          triageOutcome: true,
          scopeKind: true,
          scopeRationale: true,
          createdAt: true,
          completedAt: true,
          resolution: true,
          activities: {
            orderBy: { recordedAt: "asc" },
            select: {
              id: true,
              kind: true,
              summary: true,
              recordedAt: true,
              payload: true,
            },
          },
        },
      },
    },
  });

  await mkdir(args.out, { recursive: true });

  const written: Array<{ epicId: string; file: string; itemCount: number }> = [];
  const skipped: BacklogCaptureSkip[] = [];
  let capturedItems = 0;

  for (const epic of epics) {
    if (epic.backlogItems.length === 0) continue;
    const items = epic.backlogItems.map(
      (item) => ({ ...item, epicId: epic.epicId }) as unknown as BacklogCaptureItemRow,
    );
    const result = buildBacklogRecoveryBundle({
      bundleId: `capture-${epic.epicId.toLowerCase()}`,
      description: `Backlog captured from this installation on ${capturedAt}.`,
      capturedAt,
      repository: "OpenDigitalProductFactory/opendigitalproductfactory",
      planPath: "docs/superpowers/plans/2026-08-22-instance-identity-and-purpose.md",
      epic: { ...epic, epicId: epic.epicId } as never,
      items,
    });
    skipped.push(...result.skipped);
    if (!result.bundle) continue;

    const file = bundleFileName(epic.epicId);
    await writeFile(
      resolve(args.out, file),
      `${JSON.stringify(result.bundle, null, 2)}\n`,
      "utf8",
    );
    written.push({ epicId: epic.epicId, file, itemCount: result.bundle.items.length });
    capturedItems += result.bundle.items.length;
  }

  // The bundle format is single-epic and requires an epicId on every item, so
  // items with no epic cannot be represented. They are still real work, so they
  // are written to their own file and reported — never dropped in silence.
  const orphans = await prisma.backlogItem.findMany({
    where: {
      epicId: null,
      ...(statusFilter ? { status: statusFilter } : {}),
    },
    orderBy: { itemId: "asc" },
    select: {
      itemId: true,
      title: true,
      body: true,
      status: true,
      type: true,
      workType: true,
      source: true,
      priority: true,
      effortSize: true,
      triageOutcome: true,
      scopeKind: true,
      scopeRationale: true,
      createdAt: true,
      completedAt: true,
      resolution: true,
    },
  });
  if (orphans.length > 0) {
    await writeFile(
      resolve(args.out, "unassigned-items.json"),
      `${JSON.stringify({ schemaVersion: 1, capturedAt, items: orphans }, null, 2)}\n`,
      "utf8",
    );
    for (const orphan of orphans) {
      skipped.push({ itemId: orphan.itemId, reason: "item-has-no-epic" });
    }
  }

  const unfinishedItemCount = await prisma.backlogItem.count({
    where: { status: { in: [...UNFINISHED_STATUSES] } },
  });

  const manifest = {
    schemaVersion: 1,
    capturedAt,
    scope: args.all ? "all" : "unfinished",
    bundles: written,
    capturedItemCount: capturedItems,
    unassignedItemCount: orphans.length,
    unfinishedItemCount,
    skipped,
  };
  await writeFile(
    resolve(args.out, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  if (args.receipt) {
    // The receipt is what lets the instance stance report that teardown is safe.
    const receipt = {
      schemaVersion: 1,
      capturedAt,
      bundlePath: args.out,
      itemCount: capturedItems,
      unfinishedItemCount,
    };
    await prisma.platformConfig.upsert({
      where: { key: CAPTURE_CONFIG_KEY },
      create: { key: CAPTURE_CONFIG_KEY, value: receipt },
      update: { value: receipt },
    });
  }

  process.stdout.write(
    [
      `Captured ${capturedItems} item(s) across ${written.length} bundle(s) into ${args.out}`,
      `Unfinished items on this installation: ${unfinishedItemCount}`,
      orphans.length
        ? `Wrote ${orphans.length} item(s) with no epic to unassigned-items.json (not reconcilable — re-file them under an epic).`
        : "No items without an epic.",
      skipped.length
        ? `Skipped ${skipped.length} item(s): ${skipped.map((s) => `${s.itemId} (${s.reason})`).join(", ")}`
        : "Skipped 0 items.",
      args.receipt ? `Recorded capture receipt at ${CAPTURE_CONFIG_KEY}.` : "No receipt recorded.",
    ].join("\n") + "\n",
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
