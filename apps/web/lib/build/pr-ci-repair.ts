// apps/web/lib/build/pr-ci-repair.ts
//
// BI-085A37EC: a Build Studio PR that goes red on a required check is sent back
// to the build's own repair loop, and the repair reaches the same PR as one
// follow-up commit. FB-2F2D46D5 / PR #6983 went red on 2026-11-12 (mobile
// typecheck and jest) and the PR follow-through reconciler could only stage the
// repair for a person: no dispatcher was wired (design §8 open question).
//
// WWMD DI-8172B1A35993 settled §8: reuse what exists. The failing checks, their
// run URLs and a bounded tail of each failing job's log go to gauntlet repair
// (ship -> review -> build, its own bound kept). When the repaired build is back
// in ship, create_portal_pr publishes onto the PR head as a fast-forward
// (publishBranchCommit followUpOf), never force. The PR-level budget is the
// follow-through record's (2 per PR); this module spends none of its own.
//
// State is the build's trail: a "[dispatched head=<sha>]" row under
// PR_CI_REPAIR_TOOL is pending until an auto_open_pr row settles it. The
// publish side lives in pr-ci-follow-up.ts, which the ship path imports; this
// module is the reconciler's dispatcher only, so the two stay out of a cycle.
import type { PrRepairPacket } from "./pr-follow-through";
import type { GauntletFailure, RouteOutcome } from "./gauntlet-repair";

import { PR_CI_REPAIR_TOOL } from "./pr-ci-repair-markers";

const MAX_EXCERPT_CHARS = 4000;
const ERROR_LINE = /\berror\b|\bfail(?:ed|ure)?\b|cannot find|expected|✕|×|exit code [1-9]/i;
const TIMESTAMP = /^\d{4}-\d\d-\d\dT[\d:.]+Z\s?/;

/** The GitHub Actions job id in a check run's details URL, or null. */
export function jobIdFromRunUrl(url: string | null | undefined): number | null {
  const id = url ? /\/job\/(\d+)/.exec(url)?.[1] : undefined;
  return id ? Number(id) : null;
}

/** The lines that say what failed, then the tail, without timestamps, bounded. */
export function failingLogExcerpt(log: string): string {
  const lines = log.split(/\r?\n/).map((line) => line.replace(TIMESTAMP, "")).filter((line) => line.trim());
  const errors = lines.filter((line) => ERROR_LINE.test(line)).slice(0, 20);
  const tail = lines.slice(-20).filter((line) => !errors.includes(line));
  const excerpt = [...errors, ...(tail.length ? ["…", ...tail] : [])].join("\n");
  return excerpt.length > MAX_EXCERPT_CHARS ? excerpt.slice(-MAX_EXCERPT_CHARS) : excerpt;
}

export type PrCiRepairDeps = {
  phaseOf(buildId: string): Promise<string | null>;
  readJobLog(jobId: number): Promise<string | null>;
  /** Guarded ship->review flip that keeps the gauntlet repair bound (ship-refusal-remedy). */
  returnToReview(buildId: string): Promise<boolean>;
  routeToRepair(buildId: string, failure: GauntletFailure): Promise<RouteOutcome>;
  queueReview(buildId: string): Promise<void>;
  record(buildId: string, summary: string): Promise<void>;
};

export type PrCiRepairGithub = { owner: string; repo: string; token: string };

/** The reconciler's dispatcher for a Build Studio room (DispatchPrRepair). */
export async function dispatchBuildPrCiRepair(
  input: { buildId: string; packet: PrRepairPacket; github?: PrCiRepairGithub },
  deps: PrCiRepairDeps = productionDeps(input.github),
): Promise<"dispatched" | "unavailable"> {
  const { buildId, packet } = input;
  const defects = packet.failingChecks.filter((check) => check.class === "defect");
  if (defects.length === 0 || (await deps.phaseOf(buildId)) !== "ship") return "unavailable";

  const findings = [];
  for (const check of defects) {
    const jobId = jobIdFromRunUrl(check.runUrl);
    const log = jobId ? await deps.readJobLog(jobId).catch(() => null) : null;
    findings.push({
      severity: "important",
      description: [
        `Required check "${check.name}" failed (${check.conclusion}) on pull request head ${packet.headSha.slice(0, 12)}${check.runUrl ? `: ${check.runUrl}` : ""}.`,
        log ? failingLogExcerpt(log) : "The job log could not be read; open the run above.",
      ].join("\n"),
    });
  }

  if (!(await deps.returnToReview(buildId))) return "unavailable";
  const names = defects.map((check) => check.name);
  const routed = await deps.routeToRepair(buildId, {
    treeSha: null,
    recordId: null,
    failedGuards: names,
    source: "tests",
    findings,
  });
  if (routed !== "repair-queued") {
    // Not taken (escalated, not ready): the build is verified again rather than left out of ship.
    await deps.queueReview(buildId);
    await deps.record(buildId, `[not-dispatched head=${packet.headSha}] ${routed}: ${names.join(", ")}`);
    return "unavailable";
  }
  await deps.record(
    buildId,
    `[dispatched head=${packet.headSha}] attempt ${packet.attempt} of ${packet.bound}: handed ${names.join(", ")} back to the coding agent; the repair will be pushed to the pull request as a follow-up commit.`,
  );
  return "dispatched";
}

function productionDeps(github: PrCiRepairGithub | undefined): PrCiRepairDeps {
  const db = async () => (await import("@dpf/db")).prisma;
  return {
    async phaseOf(buildId) {
      return (await (await db()).featureBuild.findUnique({ where: { buildId }, select: { phase: true } }))?.phase ?? null;
    },
    async readJobLog(jobId) {
      if (!github) return null;
      const response = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(github.owner)}/${encodeURIComponent(github.repo)}/actions/jobs/${jobId}/logs`,
        { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${github.token}`, "User-Agent": "dpf-pr-ci-repair" } },
      );
      return response.ok ? (await response.text()).slice(-200_000) : null;
    },
    async returnToReview(buildId) {
      return (await import("./ship-refusal-remedy")).shipBuildHandBack().returnToReview(buildId);
    },
    async routeToRepair(buildId, failure) {
      return (await import("./gauntlet-repair")).routeGauntletFailureToRepair(buildId, failure);
    },
    async queueReview(buildId) {
      await (await import("./ship-refusal-remedy")).shipBuildHandBack().queueReview(buildId);
    },
    async record(buildId, summary) {
      await (await db()).buildActivity.create({ data: { buildId, tool: PR_CI_REPAIR_TOOL, summary: summary.slice(0, 1000) } }).catch(() => {});
    },
  };
}
