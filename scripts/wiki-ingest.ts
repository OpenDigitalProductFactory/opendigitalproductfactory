#!/usr/bin/env tsx
// scripts/wiki-ingest.ts
// EP-WIKI-001 Phase 2.1 CLI — pull a raw source file into the wiki kernel
// (or a per-org overlay) as a citable RawSource row + WikiIngestEvent
// audit. Phase 2.1 is intentionally source-only: no LLM call, no wiki
// page touched. Phase 2.2 adds the LLM proposal pipeline; Phase 2.3 adds
// the commit + agent surface.
//
// Usage:
//   pnpm exec tsx scripts/wiki-ingest.ts \
//     --source docs/founder-kernel/raw-sources/articles/sibling-portfolios.md
//
//   pnpm exec tsx scripts/wiki-ingest.ts \
//     --source path/to/article.md \
//     --org org_acme \
//     --type article \
//     --key articles/custom-slug
//
// Flags:
//   --source <path>   Path to the markdown source file. Required.
//   --org <orgId>     Org id for overlay ingest. Omit for kernel ingest.
//   --kernel          Mark the row as kernel content (default: false).
//   --type <type>     Override the derived sourceType
//                     (paper | article | spec | doc | framework | external-url).
//   --key <slug>      Override the derived sourceKey.
//   --kernel-version  Pass through to the audit row's kernelVersion.
//   --user <userId>   Attribution for the audit row.

import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { prisma } from "@dpf/db";
import { ingestRawSourceFromFile } from "../apps/web/lib/wiki/ingest";
import { isRawSourceType, type RawSourceType } from "@dpf/db/wiki-store";

type CliFlags = {
  source?: string;
  org?: string;
  kernel: boolean;
  type?: RawSourceType;
  key?: string;
  kernelVersion?: string;
  user?: string;
};

function parseArgs(argv: readonly string[]): CliFlags {
  const flags: CliFlags = { kernel: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string | undefined => argv[++i];
    switch (arg) {
      case "--source":
        flags.source = next();
        break;
      case "--org":
        flags.org = next();
        break;
      case "--kernel":
        flags.kernel = true;
        break;
      case "--type": {
        const value = next();
        if (!value || !isRawSourceType(value)) {
          throw new Error(
            `--type must be one of: paper, article, spec, doc, framework, external-url`,
          );
        }
        flags.type = value;
        break;
      }
      case "--key":
        flags.key = next();
        break;
      case "--kernel-version":
        flags.kernelVersion = next();
        break;
      case "--user":
        flags.user = next();
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }
  return flags;
}

function printHelp(): void {
  process.stdout.write(`wiki-ingest — Phase 2.1 source-layer CLI

Usage:
  pnpm exec tsx scripts/wiki-ingest.ts --source <path> [options]

Required:
  --source <path>           Path to a markdown source file.

Optional:
  --org <orgId>             Org id for overlay ingest. Omit for kernel.
  --kernel                  Mark the row as kernel content.
  --type <type>             Source type override (paper|article|spec|doc|framework|external-url).
  --key <slug>              sourceKey override (default: derived from path).
  --kernel-version <ver>    Stamp the audit row with this kernel version.
  --user <userId>           Attribution for the audit row.
  --help, -h                Show this message.
`);
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  if (!flags.source) {
    printHelp();
    throw new Error("--source is required");
  }

  const filePath = resolve(process.cwd(), flags.source);
  if (!existsSync(filePath)) {
    throw new Error(`Source file does not exist: ${filePath}`);
  }

  const result = await ingestRawSourceFromFile(prisma, {
    filePath,
    sourceType: flags.type,
    sourceKey: flags.key,
    organizationId: flags.org ?? null,
    isKernel: flags.kernel,
    userId: flags.user ?? null,
    kernelVersion: flags.kernelVersion ?? null,
  });

  const verb = result.isNew ? "Created" : "Updated";
  process.stdout.write(
    `${verb} RawSource ${result.sourceKey} (id=${result.rawSourceId}, type=${result.sourceType}).\n`,
  );
  process.stdout.write(`Audit event: ${result.eventId}.\n`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    process.stderr.write(`wiki-ingest failed: ${(err as Error).message}\n`);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
