// apps/web/lib/assurance/remediation-merge-live.ts
//
// P2.2 — LIVE (dark-by-default) adapters for the WWMD merge gate
// (remediation-merge-orchestrator.ts). Reads ready assurance-remediation PRs and
// their GitHub readiness, runs the gate, and escalates the non-auto ones.
//
// SAFETY: the merge actuation is the only irreversible step and is NOT implemented
// here — `armAutoMerge` throws. While `actuationEnabled` is false (the default),
// the orchestrator dark-records auto-merge decisions instead of calling it, so this
// lane does ONLY reads + escalation (filing an issue report). Enabling actuation
// (P2.2b) MUST first implement `armAutoMerge` (GitHub GraphQL enablePullRequestAutoMerge)
// AND wire real cooldown/OSV verifiers (see getReadiness) — verified against a real
// remediation PR. The throw is a hard backstop against flipping the flag early.

import { readGithubPullRequests } from "@/lib/contributor-change-lanes/github-rest-reader";
import { createPlatformIssueReport } from "@/lib/quality/platform-issue-reports";
import { ASSURANCE_ORIGIN_MARKER } from "./remediation-teeup";
import type { MergeGateAdapters, PrReadiness, ReadyRemediationPR } from "./remediation-merge-orchestrator";

/** Map GitHub's mergeable_state to the gate's CI/conflict signals. Only "clean"
 *  (mergeable + required checks passing) counts as green; everything else
 *  (blocked/unstable/behind/unknown) escalates, and "dirty" is a conflict. Pure. */
export function mapMergeStateToReadiness(mergeStateStatus: string | null): {
  ciGreen: boolean;
  hasConflict: boolean;
} {
  const s = (mergeStateStatus ?? "").toLowerCase();
  return { ciGreen: s === "clean", hasConflict: s === "dirty" };
}

/** Extract the from/to versions from an auto-filed remediation BI body
 *  ("Observed: pkg@X" → from; "Patched: <range>" → to). Pure; null when absent. */
export function parseRemediationVersions(body: string | null): { from: string | null; to: string | null } {
  const text = body ?? "";
  const observed = /Observed:\s*\S+?@([0-9][^\s)]*)/i.exec(text);
  const patched = /Patched:[^0-9\n]*([0-9][^\s,)]*)/i.exec(text);
  return { from: observed?.[1] ?? null, to: patched?.[1] ?? null };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type LiveMergeGatePrisma = {
  backlogItem: { findMany(args: any): Promise<any[]> };
  workCapsule: { findMany(args: any): Promise<any[]> };
  featureBuild: { findMany(args: any): Promise<any[]> };
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface LiveMergeGateDeps {
  prisma: LiveMergeGatePrisma;
  actuationEnabled: boolean;
  fetchImpl?: typeof fetch;
}

/** Assemble the live merge-gate adapters. armAutoMerge is intentionally a
 *  throwing stub (see file header) — unreachable while dark. */
export async function createLiveMergeGateAdapters(deps: LiveMergeGateDeps): Promise<MergeGateAdapters> {
  const { prisma, actuationEnabled } = deps;

  // Fetch the open-PR list once; getReadiness reads from this map.
  let prMap: Map<number, string | null> | null = null;
  const ensurePrMap = async (): Promise<Map<number, string | null>> => {
    if (prMap) return prMap;
    const map = new Map<number, string | null>();
    const res = await readGithubPullRequests({ fetchImpl: deps.fetchImpl });
    if (res.ok) {
      for (const row of res.rows) {
        const p = row.payload as { number?: number; mergeStateStatus?: string | null };
        if (typeof p?.number === "number") map.set(p.number, p.mergeStateStatus ?? null);
      }
    }
    prMap = map;
    return map;
  };

  return {
    actuationEnabled,

    listReadyRemediationPRs: async (): Promise<ReadyRemediationPR[]> => {
      const bis = await prisma.backlogItem.findMany({
        where: {
          body: { contains: ASSURANCE_ORIGIN_MARKER },
          activeBuildId: { not: null },
          status: { in: ["open", "in-progress"] },
        },
        select: { itemId: true, title: true, body: true, activeBuildId: true },
      });
      if (bis.length === 0) return [];

      const buildPks = bis.map((b) => b.activeBuildId).filter((v): v is string => typeof v === "string");
      const capsules = await prisma.workCapsule.findMany({
        where: { featureBuildId: { in: buildPks }, pullRequestNumber: { not: null } },
        select: { featureBuildId: true, pullRequestNumber: true, pullRequestUrl: true },
      });
      const capByBuild = new Map<string, { pullRequestNumber: number | null; pullRequestUrl: string | null }>(
        capsules.map((c) => [c.featureBuildId as string, { pullRequestNumber: c.pullRequestNumber, pullRequestUrl: c.pullRequestUrl }]),
      );
      const builds = await prisma.featureBuild.findMany({
        where: { id: { in: buildPks } },
        select: { id: true, buildId: true },
      });
      const buildIdByPk = new Map<string, string>(builds.map((b) => [b.id as string, b.buildId as string]));

      const out: ReadyRemediationPR[] = [];
      for (const bi of bis) {
        const buildPk = bi.activeBuildId as string | null;
        if (!buildPk) continue;
        const cap = capByBuild.get(buildPk);
        if (!cap || typeof cap.pullRequestNumber !== "number") continue;
        const { from, to } = parseRemediationVersions(bi.body);
        out.push({
          buildId: buildIdByPk.get(buildPk) ?? buildPk,
          buildPk,
          backlogItemId: bi.itemId,
          prNumber: cap.pullRequestNumber,
          title: bi.title,
          fromVersion: from,
          toVersion: to,
        });
      }
      return out;
    },

    getReadiness: async (pr): Promise<PrReadiness> => {
      const map = await ensurePrMap();
      const { ciGreen, hasConflict } = mapMergeStateToReadiness(map.get(pr.prNumber) ?? null);
      // TODO(P2.2b): wire real verifiers BEFORE enabling actuation —
      //   cooldownMet: npm-registry release age of pr.toVersion (anti-hijack);
      //   osvClean:    OSV query that pr.toVersion has no advisory.
      // Until then these are optimistic; the dark gate + the armAutoMerge throw
      // keep it from merging anything.
      return { ciGreen, hasConflict, cooldownMet: true, osvClean: true };
    },

    armAutoMerge: async (): Promise<void> => {
      throw new Error(
        "assurance auto-merge actuation not implemented (P2.2b) — implement GitHub auto-merge + cooldown/OSV verifiers and verify against a real PR before enabling DPF_ASSURANCE_AUTOMERGE_ENABLED",
      );
    },

    escalate: async (pr, reason): Promise<void> => {
      await createPlatformIssueReport({
        type: "build-stall-escalation",
        source: "build-studio",
        severity: "high",
        title: `Assurance remediation needs a human merge decision: PR #${pr.prNumber}`,
        description:
          `Remediation PR #${pr.prNumber} ("${pr.title}") for ${pr.backlogItemId} was NOT auto-merged by the ` +
          `assurance merge gate.\n\nReason: ${reason}\n\nDecide the merge manually. ` +
          `(Assurance remediation lane P2 — WWMD patch-only-auto gate, BI-204EE70B.)`,
        featureBuildId: pr.buildPk,
        triggerKind: "assurance-remediation-merge-gate",
        dedupeKey: `assurance-merge-escalation:${pr.prNumber}`,
        selfFixClass: "needs-human",
      });
    },
  };
}
