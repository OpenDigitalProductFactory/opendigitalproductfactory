import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Prisma } from "../generated/client/client";
import {
  parseBacklogRecoveryBundle,
  reconcileBacklogRecoveryBundle,
  type BacklogRecoveryStore,
} from "../src/backlog-recovery-bundle";
import { prisma } from "../src/client";

const DEFAULT_BUNDLE = fileURLToPath(
  new URL(
    "../data/backlog-recovery/purpose-aware-installation-ecosystem-productivity.json",
    import.meta.url,
  ),
);

function usage(): string {
  return [
    "Usage: pnpm --filter @dpf/db backlog:reconcile -- [bundle.json] [--apply]",
    "",
    "Defaults to the committed purpose-aware installation recovery bundle.",
    "Without --apply, validates the bundle and prints a read-only reconciliation preview.",
    "With --apply, atomically creates missing records and skips every existing record wholesale.",
  ].join("\n");
}

function parseArgs(argv: string[]): { apply: boolean; path: string } {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    process.exitCode = 0;
    return { apply: false, path: "" };
  }
  const unknownFlag = argv.find((arg) => arg.startsWith("-") && arg !== "--apply");
  if (unknownFlag) throw new Error(`Unknown option: ${unknownFlag}\n\n${usage()}`);
  const paths = argv.filter((arg) => !arg.startsWith("-"));
  if (paths.length > 1) throw new Error(`Expected at most one bundle path.\n\n${usage()}`);
  return {
    apply: argv.includes("--apply"),
    path: paths[0] ? resolve(process.cwd(), paths[0]) : DEFAULT_BUNDLE,
  };
}

const store: BacklogRecoveryStore = {
  transaction: (work) =>
    prisma.$transaction(
      async (tx) =>
        work({
          async findEpic(epicId) {
            const row = await tx.epic.findUnique({ where: { epicId }, select: { id: true } });
            return row ? { internalId: row.id } : null;
          },
          async findItem(itemId) {
            const row = await tx.backlogItem.findUnique({ where: { itemId }, select: { id: true } });
            return row ? { internalId: row.id } : null;
          },
          async createEpic(epic) {
            const row = await tx.epic.create({
              data: {
                epicId: epic.epicId,
                title: epic.title,
                description: epic.description,
                status: epic.status,
                priority: epic.priority,
                scopeKind: epic.scopeKind,
                scopeRationale: epic.scopeRationale,
                createdAt: epic.createdAt ? new Date(epic.createdAt) : undefined,
                completedAt: epic.completedAt ? new Date(epic.completedAt) : undefined,
              },
              select: { id: true },
            });
            return { internalId: row.id };
          },
          async createItem(item, epicInternalId) {
            const row = await tx.backlogItem.create({
              data: {
                itemId: item.itemId,
                epicId: epicInternalId,
                title: item.title,
                body: item.body,
                status: item.status,
                type: item.type,
                workType: item.workType,
                source: item.source,
                priority: item.priority,
                effortSize: item.effortSize,
                triageOutcome: item.triageOutcome,
                scopeKind: item.scopeKind,
                scopeRationale: item.scopeRationale,
                createdAt: item.createdAt ? new Date(item.createdAt) : undefined,
                completedAt: item.completedAt ? new Date(item.completedAt) : undefined,
                resolution: item.resolution,
              },
              select: { id: true },
            });
            return { internalId: row.id };
          },
          async createActivity(activity, itemInternalId, context) {
            await tx.backlogItemActivity.create({
              data: {
                backlogItemId: itemInternalId,
                kind: activity.kind,
                summary: activity.summary,
                recordedAt: new Date(activity.recordedAt),
                payload: {
                  ...activity.payload,
                  backlogRecovery: {
                    bundleId: context.bundleId,
                    recoveryKey: activity.recoveryKey,
                  },
                } as Prisma.InputJsonValue,
              },
            });
          },
        }),
      { maxWait: 10_000, timeout: 30_000 },
    ),
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.path) return;
  const source = await readFile(options.path, "utf8");
  const bundle = parseBacklogRecoveryBundle(JSON.parse(source));
  const summary = await reconcileBacklogRecoveryBundle(store, bundle, { apply: options.apply });
  process.stdout.write(`${JSON.stringify({ bundlePath: options.path, ...summary }, null, 2)}\n`);
  if (!options.apply) {
    process.stdout.write("Dry run only. Re-run with --apply to create the missing graph atomically.\n");
  }
}

main()
  .catch((error: unknown) => {
    const message =
      error instanceof Error
        ? error.message
        : error == null
          ? "Unknown reconciliation failure"
          : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
