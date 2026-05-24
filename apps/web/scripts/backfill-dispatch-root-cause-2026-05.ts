// apps/web/scripts/backfill-dispatch-root-cause-2026-05.ts
//
// One-shot operator-runnable backfill for BI-594B76AB.
// Recomputes BuildDispatchAttempt.rootCauseSummary for rows whose persisted
// value is just the Codex CLI prologue, using the post-hardening matcher
// logic. Idempotent — re-running produces the same result because the second
// pass finds no remaining prologue-matched rows.
//
// Run via:
//   pnpm --filter web exec tsx scripts/backfill-dispatch-root-cause-2026-05.ts
//
// Per feedback_no_mass_bash this script is NOT auto-run at boot. Per
// feedback_db_seed_migration_sync, since this normalizes platform diagnostic
// data and does not change schema, it lives here as a script rather than as
// a Prisma migration.

import { createHash } from "crypto";
import { prisma } from "@dpf/db";
import {
  isCliPrologueLine,
  normalizeRootCauseForHash,
  recomputeRootCauseSummary,
} from "../lib/build/dispatch-attempts";
import type { BuildFailureAxis } from "../lib/build/progress-visibility-types";

type Counters = { scanned: number; updated: number; skipped: number; errored: number };

function hashRootCause(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

async function main(): Promise<Counters> {
  const counters: Counters = { scanned: 0, updated: 0, skipped: 0, errored: 0 };

  // Pull only rows with a non-null rootCauseSummary; client-side filter on the
  // prologue pattern. The table is small (one row per dispatch attempt) so
  // an in-memory filter is acceptable.
  const rows = await prisma.buildDispatchAttempt.findMany({
    where: { rootCauseSummary: { not: null } },
    select: {
      id: true,
      rootCauseSummary: true,
      stdoutExcerpt: true,
      stderrExcerpt: true,
      failureAxis: true,
    },
  });

  for (const row of rows) {
    counters.scanned += 1;
    const summary = row.rootCauseSummary?.trim() ?? "";
    if (!summary) {
      counters.skipped += 1;
      continue;
    }
    if (!isCliPrologueLine(summary)) {
      counters.skipped += 1;
      continue;
    }
    try {
      const recomputed = recomputeRootCauseSummary({
        stdoutExcerpt: row.stdoutExcerpt,
        stderrExcerpt: row.stderrExcerpt,
        failureAxis: row.failureAxis as BuildFailureAxis,
      });
      if (recomputed === row.rootCauseSummary) {
        // Idempotent no-op — same result as already stored.
        counters.skipped += 1;
        continue;
      }
      const hash = hashRootCause(`${row.failureAxis}:${normalizeRootCauseForHash(recomputed)}`);
      await prisma.buildDispatchAttempt.update({
        where: { id: row.id },
        data: { rootCauseSummary: recomputed, rootCauseHash: hash },
      });
      counters.updated += 1;
    } catch (err) {
      counters.errored += 1;
      // eslint-disable-next-line no-console
      console.warn(`[backfill] failed to update row ${row.id}:`, err);
    }
  }

  return counters;
}

main()
  .then((counters) => {
    // eslint-disable-next-line no-console
    console.log("[backfill] done:", counters);
    return prisma.$disconnect();
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[backfill] fatal:", err);
    return prisma.$disconnect().finally(() => process.exit(1));
  });
