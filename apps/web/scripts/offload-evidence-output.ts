// apps/web/scripts/offload-evidence-output.ts
//
// BI-39AAE9B8 one-off backfill: move oversized evidence payloads that were
// written BEFORE the inline ceiling existed out of the two ledger JSON columns
// and into the content-addressed blob store. Idempotent — a row whose output is
// already an excerpt (or a bounded marker) is below the ceiling and is skipped.
//
//   pnpm --filter web exec tsx scripts/offload-evidence-output.ts            # dry run (default)
//   pnpm --filter web exec tsx scripts/offload-evidence-output.ts --apply    # rewrite rows
//
// Runs against the canonical install's database (DATABASE_URL). Reports bytes
// reclaimed per table. Reclaimed heap is returned to Postgres by autovacuum;
// pg_total_relation_size shrinks once the TOAST pages are vacuumed, not at the
// moment of the UPDATE.

import { prisma } from "@dpf/db";

import {
  boundLargeStrings,
  offloadEvidenceOutput,
  utf8ByteLength,
  EVIDENCE_INLINE_CEILING_BYTES,
} from "../lib/evidence/bounded-output";

const apply = process.argv.includes("--apply");
const batch = 50;

function jsonBytes(value: unknown): number {
  return utf8ByteLength(JSON.stringify(value ?? null));
}

async function offloadExternalEvidenceRecords(): Promise<{ scanned: number; rewritten: number; reclaimed: number }> {
  let scanned = 0;
  let rewritten = 0;
  let reclaimed = 0;
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.externalEvidenceRecord.findMany({
      where: { operationType: "local_integration_ci" },
      orderBy: { id: "asc" },
      take: batch,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, details: true },
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      scanned += 1;
      cursor = row.id;
      const details = row.details as Record<string, unknown> | null;
      const evidence = details?.evidence;
      if (!evidence || typeof evidence !== "object") continue;
      const output = (evidence as Record<string, unknown>).output;
      if (typeof output !== "string" || utf8ByteLength(output) <= EVIDENCE_INLINE_CEILING_BYTES) continue;
      const before = jsonBytes(details);
      const bounded = await offloadEvidenceOutput(evidence);
      const nextDetails = { ...details, evidence: bounded };
      reclaimed += before - jsonBytes(nextDetails);
      rewritten += 1;
      if (apply) {
        await prisma.externalEvidenceRecord.update({
          where: { id: row.id },
          data: { details: nextDetails as never },
        });
      }
    }
  }
  return { scanned, rewritten, reclaimed };
}

async function boundToolExecutionParameters(): Promise<{ scanned: number; rewritten: number; reclaimed: number }> {
  let scanned = 0;
  let rewritten = 0;
  let reclaimed = 0;
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.toolExecution.findMany({
      where: { toolName: { in: ["record_local_integration_result", "record_external_development_evidence"] } },
      orderBy: { id: "asc" },
      take: batch,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, parameters: true },
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      scanned += 1;
      cursor = row.id;
      const before = jsonBytes(row.parameters);
      const bounded = boundLargeStrings(row.parameters);
      if (bounded === row.parameters) continue;
      // The ledger keeps digest + head only; the full bytes are (or will be, once
      // the matching ExternalEvidenceRecord is offloaded) in the blob store
      // under the same sha256.
      reclaimed += before - jsonBytes(bounded);
      rewritten += 1;
      if (apply) {
        await prisma.toolExecution.update({ where: { id: row.id }, data: { parameters: bounded as never } });
      }
    }
  }
  return { scanned, rewritten, reclaimed };
}

async function main(): Promise<void> {
  const evidence = await offloadExternalEvidenceRecords();
  const ledger = await boundToolExecutionParameters();
  const mb = (n: number) => (n / 1048576).toFixed(1);
  console.log(`[offload-evidence-output] mode=${apply ? "apply" : "dry-run"}`);
  console.log(`  ExternalEvidenceRecord: scanned=${evidence.scanned} rewritten=${evidence.rewritten} reclaimed=${mb(evidence.reclaimed)} MB (uncompressed JSON)`);
  console.log(`  ToolExecution:          scanned=${ledger.scanned} rewritten=${ledger.rewritten} reclaimed=${mb(ledger.reclaimed)} MB (uncompressed JSON)`);
  if (!apply) console.log("  (dry run — pass --apply to rewrite rows)");
}

main()
  .catch((err) => {
    console.error("[offload-evidence-output] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
