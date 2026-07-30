// apps/web/lib/assurance/remediation-merge-live.ts
//
// P2.2 / P2.2b — LIVE adapters for the WWMD merge gate
// (remediation-merge-orchestrator.ts). Reads ready assurance-remediation PRs +
// their readiness, runs the gate, and either ARMS auto-merge (P2.2b) or escalates.
//
// SAFETY: merge actuation stays behind ONE switch — `actuationEnabled`
// (DPF_ASSURANCE_AUTOMERGE_ENABLED, default off). While off, the orchestrator
// dark-records auto-merge decisions and never calls armAutoMerge, so the lane does
// only reads + escalation. The decision gate is also strict (patch-only + CI-green
// + release-age cooldown + OSV-clean + no-conflict), so even when the flag is on,
// only a fully-verified patch bump is ever auto-merged.

import {
  readGithubPullRequests,
  resolveGithubToken,
  resolveRepoIdentity,
} from "@/lib/contributor-change-lanes/github-rest-reader";
import { createPlatformIssueReport } from "@/lib/quality/platform-issue-reports";
import {
  enablePullRequestAutoMerge,
  resolvePullRequestNodeId,
} from "@/lib/integrate/github-pr-readiness";
import { ASSURANCE_ORIGIN_MARKER } from "./remediation-teeup";
import type { MergeGateAdapters, PrReadiness, ReadyRemediationPR } from "./remediation-merge-orchestrator";

const NPM_REGISTRY_BASE = process.env.NPM_REGISTRY_BASE ?? "https://registry.npmjs.org";
const OSV_BASE = process.env.OSV_BASE_URL ?? "https://api.osv.dev";

/** Release-age cooldown for an auto-mergeable bump (hijacked-release guard; mirrors
 *  the Dependabot patch cooldown). The bumped release must be at least this old. */
export const ASSURANCE_REMEDIATION_COOLDOWN_DAYS = 3;


// ─── pure helpers ─────────────────────────────────────────────────────────────

/** Map GitHub's mergeable_state to the gate's CI/conflict signals. Only "clean"
 *  (mergeable + required checks passing) counts as green; "dirty" is a conflict;
 *  everything else (blocked/unstable/behind/unknown) escalates. Pure. */
export function mapMergeStateToReadiness(mergeStateStatus: string | null): {
  ciGreen: boolean;
  hasConflict: boolean;
} {
  const s = (mergeStateStatus ?? "").toLowerCase();
  return { ciGreen: s === "clean", hasConflict: s === "dirty" };
}

/** Extract from/to versions from an auto-filed body ("Observed: pkg@X" / "Patched: <range>"). Pure. */
export function parseRemediationVersions(body: string | null): { from: string | null; to: string | null } {
  const text = body ?? "";
  const observed = /Observed:\s*\S+?@([0-9][^\s)]*)/i.exec(text);
  const patched = /Patched:[^0-9\n]*([0-9][^\s,)]*)/i.exec(text);
  return { from: observed?.[1] ?? null, to: patched?.[1] ?? null };
}

/** Package name from an auto-filed body ("Observed: NAME@ver", incl. @scope/name). Pure. */
export function parseObservedPackage(body: string | null): string | null {
  const m = /Observed:\s*(\S+?)@[0-9]/i.exec(body ?? "");
  return m?.[1] ?? null;
}

/** True if `publishedAtIso` is at least `minDays` old as of `now`. Unknown → false. Pure. */
export function isReleaseAgedEnough(publishedAtIso: string | null, now: Date, minDays: number): boolean {
  if (!publishedAtIso) return false;
  const t = Date.parse(publishedAtIso);
  if (Number.isNaN(t)) return false;
  return now.getTime() - t >= minDays * 24 * 60 * 60 * 1000;
}

/** Interpret an OSV /v1/querybatch response (single query): clean only when the
 *  result is present and carries no vulns; malformed/empty → not clean (escalate). Pure. */
export function osvBatchClean(response: unknown): boolean {
  const results = (response as { results?: Array<{ vulns?: unknown[] }> } | null)?.results;
  if (!Array.isArray(results) || results.length === 0) return false;
  const vulns = results[0]?.vulns;
  return !Array.isArray(vulns) || vulns.length === 0;
}

// ─── live readiness checks (injectable fetch) ─────────────────────────────────

/** npm release-age cooldown check for `pkg@version`. Conservative: any
 *  missing input / fetch failure → false (→ the gate escalates). */
export async function fetchReleaseCooldownMet(
  fetchImpl: typeof fetch,
  pkg: string | null,
  version: string | null,
  now: Date,
): Promise<boolean> {
  if (!pkg || !version) return false;
  // Scoped names keep the leading @, with EVERY slash percent-encoded for the
  // registry path (global replace — a single-occurrence replace is an incomplete
  // escape, CodeQL js/incomplete-sanitization).
  const path = pkg.startsWith("@") ? pkg.replace(/\//g, "%2F") : pkg;
  try {
    const res = await fetchImpl(`${NPM_REGISTRY_BASE}/${path}`, { headers: { Accept: "application/json" } });
    if (!res.ok) return false;
    const json = (await res.json()) as { time?: Record<string, string> };
    return isReleaseAgedEnough(json.time?.[version] ?? null, now, ASSURANCE_REMEDIATION_COOLDOWN_DAYS);
  } catch {
    return false;
  }
}

/** OSV-clean check for `pkg@version` (the bump target). Conservative: missing
 *  input / fetch failure → false. */
export async function fetchOsvClean(
  fetchImpl: typeof fetch,
  pkg: string | null,
  version: string | null,
): Promise<boolean> {
  if (!pkg || !version) return false;
  try {
    const res = await fetchImpl(`${OSV_BASE}/v1/querybatch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ queries: [{ package: { ecosystem: "npm", name: pkg }, version }] }),
    });
    if (!res.ok) return false;
    return osvBatchClean(await res.json());
  } catch {
    return false;
  }
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
  now?: Date;
}

export async function createLiveMergeGateAdapters(deps: LiveMergeGateDeps): Promise<MergeGateAdapters> {
  const { prisma, actuationEnabled } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? new Date();

  // Fetch the open-PR list once; getReadiness reads mergeStateStatus from this map.
  let prMap: Map<number, string | null> | null = null;
  const ensurePrMap = async (): Promise<Map<number, string | null>> => {
    if (prMap) return prMap;
    const map = new Map<number, string | null>();
    const res = await readGithubPullRequests({ fetchImpl });
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
      const capByBuild = new Map<string, { pullRequestNumber: number | null }>(
        capsules.map((c) => [c.featureBuildId as string, { pullRequestNumber: c.pullRequestNumber }]),
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
          packageName: parseObservedPackage(bi.body),
          fromVersion: from,
          toVersion: to,
        });
      }
      return out;
    },

    getReadiness: async (pr): Promise<PrReadiness> => {
      const map = await ensurePrMap();
      const { ciGreen, hasConflict } = mapMergeStateToReadiness(map.get(pr.prNumber) ?? null);
      const [cooldownMet, osvClean] = await Promise.all([
        fetchReleaseCooldownMet(fetchImpl, pr.packageName ?? null, pr.toVersion, now),
        fetchOsvClean(fetchImpl, pr.packageName ?? null, pr.toVersion),
      ]);
      return { ciGreen, hasConflict, cooldownMet, osvClean };
    },

    // P2.2b: real actuation — GitHub GraphQL enablePullRequestAutoMerge. Reached
    // only when actuationEnabled AND the strict gate passed for this PR.
    armAutoMerge: async (pr): Promise<void> => {
      const tokenPrisma = prisma as unknown as Parameters<typeof resolveGithubToken>[0];
      const token = await resolveGithubToken(tokenPrisma);
      if (!token) {
        throw new Error("assurance auto-merge: no GitHub token (github-pr-sync credential not active)");
      }
      const repo = await resolveRepoIdentity(tokenPrisma);
      const nodeId = await resolvePullRequestNodeId({
        fetchImpl,
        token,
        owner: repo.owner,
        repo: repo.name,
        prNumber: pr.prNumber,
      });
      await enablePullRequestAutoMerge({ fetchImpl, token, nodeId });
    },

    escalate: async (pr, reason): Promise<void> => {
      await createPlatformIssueReport({
        type: "build-stall-escalation",
        source: "build-studio",
        severity: "high",
        title: `Assurance remediation needs an owner merge decision: PR #${pr.prNumber}`,
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
