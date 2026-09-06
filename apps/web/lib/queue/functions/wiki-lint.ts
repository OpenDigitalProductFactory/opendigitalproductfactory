// EP-WIKI-001 Phase 4b1: scheduled wiki lint job.
// Spec: docs/superpowers/specs/2026-05-09-platform-kernel-wiki-design.md §6
// Plan: docs/superpowers/plans/2026-05-09-platform-kernel-wiki.md (Phase 4b)
//
// Runs runWikiLint() for the kernel (organizationId=null) and then for
// every active Organization. Mirrors infra-prune.ts's pattern of
// dynamic Prisma + helper imports inside step.run so the function file
// itself stays tree-shaken when Inngest registers schedules at build.

import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

// Daily at 03:30 UTC (matches the time spec §3.6 calls out). Two
// retries because the orchestrator is idempotent — re-running on
// failure is safe and surfaces transient DB hiccups.
export const wikiLint = inngest.createFunction(
  { id: "wiki/lint-daily", retries: 2, triggers: [cron("30 3 * * *")] },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "wiki/lint-daily");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    const orgIds = await step.run("collect-active-orgs", async () => {
      const { prisma } = await import("@dpf/db");
      const orgs = await prisma.organization.findMany({
        select: { id: true },
      });
      return orgs.map((o) => o.id);
    });

    const kernelResult = await step.run("lint-kernel", async () => {
      const { prisma } = await import("@dpf/db");
      const { runWikiLint } = await import("@/lib/wiki/lint");
      return runWikiLint({
        organizationId: null,
        prisma: prisma as never,
        currentKernelVersion: await readKernelVersion(),
      });
    });

    const orgResults: Array<{ organizationId: string; opened: number; resolved: number; scanned: number }> = [];
    for (const orgId of orgIds) {
      const r = await step.run(`lint-org-${orgId}`, async () => {
        const { prisma } = await import("@dpf/db");
        const { runWikiLint } = await import("@/lib/wiki/lint");
        return runWikiLint({
          organizationId: orgId,
          prisma: prisma as never,
          currentKernelVersion: await readKernelVersion(),
        });
      });
      orgResults.push({
        organizationId: orgId,
        opened: r.findingsOpened,
        resolved: r.findingsResolved,
        scanned: r.scannedPageCount,
      });
    }

    return {
      kernel: {
        scanned: kernelResult.scannedPageCount,
        opened: kernelResult.findingsOpened,
        kept: kernelResult.findingsKept,
        resolved: kernelResult.findingsResolved,
      },
      orgs: orgResults,
    };
  },
);

// ─── manifest helper ────────────────────────────────────────────────────────

async function readKernelVersion(): Promise<string> {
  const { readFile } = await import("fs/promises");
  const { join } = await import("path");
  // Manifest path is the same one packages/db/src/seed-wiki-kernel.ts uses.
  // We read it directly from the repo root rather than importing the seed
  // module (which would pull in the `fs` walker and Postgres CRUD calls).
  const manifestPath = join(process.cwd(), "docs", "founder-kernel", "manifest.json");
  try {
    const raw = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as { kernelVersion?: string };
    return parsed.kernelVersion ?? "0.0.0";
  } catch {
    // If the manifest is missing (rare; ships with the repo), the kernel
    // is effectively empty — lint will still run, but the kernel-drift
    // detector becomes a no-op against unknown version "0.0.0".
    return "0.0.0";
  }
}
