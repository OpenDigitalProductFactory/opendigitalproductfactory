// apps/web/lib/queue/functions/patch-assessment-sweep.ts
// EP-PATCH-MANAGEMENT P0 — estate patch posture sweep.
//
// Daily: project every discovered software item into patch findings on the Assurance
// Ledger. Resolves OSV advisories (with CISA KEV prioritization) for the ecosystems OSV
// can query, writes/reopens AssuranceFinding rows via the canonical finding-persistence
// writer, and resolves findings that have become clean. The estate "what is vulnerable"
// posture stays current with no operator watching.
//
// Mirrors log-signature-scanner.ts: a pure exported sweep (tests drive it without the
// Inngest harness) + a thin wrapper with the quiescence gate. KEV/OSV are best-effort —
// an unreachable feed degrades coverage, it does not fail the job or fabricate findings.

import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";
import { runEstatePatchAssessment, type PatchStoreDb } from "@/lib/patch/patch-assessment-store";
import {
  createNvdCpePatchIntelProvider,
  createOsvPatchIntelProvider,
  mergePatchIntel,
} from "@/lib/patch/patch-intel-provider";
import { fetchOsvVulns } from "@/lib/patch/osv-client";
import { fetchKevCves } from "@/lib/patch/kev-client";
import { fetchNvdCveAdvisories } from "@/lib/patch/nvd-client";
import type { PatchAssessmentSummary } from "@dpf/db/patch";

/**
 * Run one estate patch assessment. Exported so tests can drive it directly. The DB and
 * feed clients are resolved here so the sweep is self-contained for the Inngest wrapper.
 */
export async function runPatchAssessmentSweep(): Promise<PatchAssessmentSummary> {
  const { prisma } = await import("@dpf/db");

  let kevCves: Set<string>;
  try {
    kevCves = await fetchKevCves();
  } catch (err) {
    console.error("[patch-assessment-sweep] CISA KEV unreachable; proceeding without KEV", err);
    kevCves = new Set();
  }

  const osvProvider = createOsvPatchIntelProvider({ fetchVulns: fetchOsvVulns, kevCves });
  const nvdProvider = createNvdCpePatchIntelProvider({
    fetchAdvisories: (cpe) => fetchNvdCveAdvisories(cpe, { kevCves }),
  });
  const provider = async (evidence: Parameters<typeof osvProvider>[0]) =>
    mergePatchIntel(await osvProvider(evidence), await nvdProvider(evidence));
  return runEstatePatchAssessment(prisma as unknown as PatchStoreDb, provider, { now: new Date() });
}

export const patchAssessmentSweep = inngest.createFunction(
  { id: "ops/patch-assessment-sweep", retries: 2, triggers: [cron("0 5 * * *")] },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "ops/patch-assessment-sweep");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return await step.run("patch-assessment", runPatchAssessmentSweep);
  },
);
