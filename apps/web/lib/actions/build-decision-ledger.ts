"use server";

import { auth } from "@/lib/auth";
import {
  loadBuildDecisionLedger,
  type BuildDecisionLedgerEntry,
} from "@/lib/build/decision-ledger";

/**
 * Read-only server action backing Band 3 ("The decisions we made & why") of the
 * Build Studio overseer layer. Returns the plain-language decision ledger for a
 * build — unifying deliberationSummary + DecisionInteraction (BI-EC934FC6).
 * Mirrors the auth gate of getFeatureBuild (build-read.ts); adds no new exposure.
 */
export async function getBuildDecisionLedgerAction(
  buildId: string,
): Promise<BuildDecisionLedgerEntry[]> {
  const session = await auth();
  if (!session?.user?.id) return [];
  return loadBuildDecisionLedger(buildId);
}
