#!/usr/bin/env tsx
// scripts/reembed-wiki-store.ts
// BI-512FBD20 — reconcile the wiki vector store against the published corpus.
//
// The runtime vector index (the `wiki-pages` collection) is best-effort: every
// write path (`storeWikiPage`, `seedWikiKernel`) skips a page when the embedding
// model is unavailable and returns without a record. So an install whose
// embedding provider was down at seed/ingest time ends up with a PARTIALLY
// embedded corpus — retrieval then silently searches a fraction of the kernel
// and `principle_decide` consults only commandments while reporting itself
// well-grounded. That was the live state on 2026-07-22: 87 of 162 published
// principles embedded.
//
// This maintainer script re-embeds every published WikiPage through the same
// `storeWikiPage` primitive the runtime uses (one definition of the payload) and
// reports coverage as a NUMBER — embedded / published — not a boolean. It refuses
// to run when the provider is down, naming the exact fix, so it can never itself
// become another silent no-op.
//
// Usage (from apps/web, provider must be reachable):
//   pnpm --filter web exec tsx scripts/reembed-wiki-store.ts            # re-embed everything
//   pnpm --filter web exec tsx scripts/reembed-wiki-store.ts --dry-run  # report coverage only
//   pnpm --filter web exec tsx scripts/reembed-wiki-store.ts --kind principle
//
// Env: DATABASE_URL and LLM_BASE_URL must resolve to the target install's
// Postgres and embedding endpoint. Inside a container both are already set; from
// the host, point LLM_BASE_URL at the mapped Docker Model Runner port
// (e.g. http://localhost:12434/engines/v1) and DATABASE_URL at the mapped Postgres.
//
// Exit code: 0 when every published page is embedded after the run; 1 when any
// page could not be embedded (fail loud — a partial re-embed is a failure, not a
// success with a warning).

import { prisma } from "@dpf/db";
import { reconcilePublishedWikiEmbeddings } from "@/lib/wiki/embedding-reconciliation";
import { isEmbeddingAvailable } from "@/lib/inference/embedding";

type Flags = { dryRun: boolean; kind: string | null };

function parseArgs(argv: readonly string[]): Flags {
  const flags: Flags = { dryRun: false, kind: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--kind") flags.kind = argv[++i] ?? null;
  }
  return flags;
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));

  // Precondition, fail loud. A re-embed against a down provider would "succeed"
  // by embedding nothing — the exact silent-degradation this BI exists to kill.
  if (!flags.dryRun) {
    const up = await isEmbeddingAvailable();
    if (!up) {
      console.error(
        "[reembed-wiki-store] ABORT — embedding provider is not reachable or the " +
          "embedding model is missing. Nothing was re-embedded.\n" +
          "  Fix: docker model pull ai/nomic-embed-text-v1.5\n" +
          "  Then verify: curl -s $LLM_BASE_URL/models | grep nomic-embed",
      );
      process.exit(1);
    }
  }

  const result = await reconcilePublishedWikiEmbeddings({ kind: flags.kind, dryRun: flags.dryRun });

  console.info(
    `[reembed-wiki-store] scanned=${result.scanned} missing=${result.missing} ` +
      `embedded=${result.embedded}` + (result.failed.length ? ` failed=${result.failed.length}` : ""),
  );
  if (result.failed.length) {
    console.error(
      `[reembed-wiki-store] ${result.failed.length} page(s) could not be embedded: ` +
        result.failed.slice(0, 20).join(", "),
    );
  }

  await prisma.$disconnect();
  process.exit(result.failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error("[reembed-wiki-store] fatal:", err);
  process.exit(1);
});
