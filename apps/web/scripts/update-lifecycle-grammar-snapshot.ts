#!/usr/bin/env tsx
// BI-EAD441E0 slice S2 — re-freeze the committed lifecycle-grammar snapshot baseline.
//
// Run this after a DELIBERATE, reviewed grammar change, once the consistency guard
// has confirmed the change negates no governing stance. It writes the current
// grammar projection to apps/web/lib/lifecycle/lifecycle-grammar-snapshot.json so
// the ratchet tracks HEAD and the next PR only sees ITS delta.
//
//   pnpm --filter web exec tsx scripts/update-lifecycle-grammar-snapshot.ts
//   pnpm --filter web exec tsx scripts/update-lifecycle-grammar-snapshot.ts --check  # verify only

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildGrammarSnapshot, serializeSnapshot } from "@/lib/lifecycle/grammar-negation";
import { checkGrammarConsistency } from "@/lib/lifecycle/grammar-consistency-check";

const BASELINE_PATH = join(process.cwd(), "lib/lifecycle/lifecycle-grammar-snapshot.json");

function main(): void {
  const check = process.argv.includes("--check");
  const current = serializeSnapshot(buildGrammarSnapshot());

  let baseline = "";
  try {
    baseline = readFileSync(BASELINE_PATH, "utf8");
  } catch {
    if (check) {
      console.error(`[lifecycle-snapshot] MISSING baseline at ${BASELINE_PATH}. Run without --check to create it.`);
      process.exit(1);
    }
  }

  if (baseline === current) {
    console.info("[lifecycle-snapshot] baseline already in sync — no change.");
    return;
  }

  // Refuse to re-freeze OVER a stance-negating change: the operator must resolve
  // the negation (or reconcile the stance) first. Never silently accept it.
  const result = checkGrammarConsistency(baseline || current);
  if (result.negating.length > 0) {
    console.error(
      "[lifecycle-snapshot] REFUSING to re-freeze — this grammar change negates a governing stance:\n" +
        result.negating.map((f) => `  - ${f.slug}: ${f.detail}`).join("\n") +
        "\nRoute it through governance (update the stance, or revert the structural change) before re-freezing.",
    );
    process.exit(1);
  }

  if (check) {
    console.error(
      "[lifecycle-snapshot] OUT OF SYNC — the grammars changed but the baseline was not re-frozen. " +
        "Run without --check to update it.",
    );
    process.exit(1);
  }

  writeFileSync(BASELINE_PATH, current);
  console.info(
    `[lifecycle-snapshot] re-froze baseline` +
      (result.weakening.length ? ` (${result.weakening.length} weakening change(s) surfaced — review the stances)` : "") +
      ".",
  );
}

main();
