/**
 * Build flow state derivation — spec §3.5.
 *
 * Produces a typed snapshot of a FeatureBuild's progress through the five
 * main-track phases plus the two Ready-to-Ship forks (Upstream PR and
 * Promote-to-Prod). Pure read: no schema changes, no new persistence. Every
 * displayed state is computed from columns that already exist on FeatureBuild,
 * FeaturePack, ChangePromotion, and PlatformDevConfig.
 *
 * See docs/superpowers/specs/2026-04-20-ship-phase-fork-redesign-design.md.
 */

import { prisma } from "@dpf/db";
import type { BuildPhase } from "@/lib/feature-build-types";
import { PHASE_LABELS } from "@/lib/feature-build-types";

// ─── Types ──────────────────────────────────────────────────────────────────

export type MainTrackPhase = "ideate" | "plan" | "build" | "review" | "ship";

export type PhaseNodeState = "pending" | "active" | "done" | "failed";

export interface MainTrackNode {
  phase: MainTrackPhase;
  label: string;
  stepsCompleted: number;
  stepsTotal: number;
  state: PhaseNodeState;
}

/**
 * Upstream PR fork terminal states.
 *
 * - `skipped`: contributionMode is "fork_only" OR user chose Keep Local.
 * - `in_progress`: contribute_to_hive is mid-flight (FeaturePack exists without prUrl yet).
 * - `shipped`: FeaturePack.prUrl is populated.
 * - `errored`: most recent contribute_to_hive activity recorded a failure.
 * - `pending`: we haven't entered ship yet, so the fork has no state to display.
 */
export type UpstreamForkState = "pending" | "skipped" | "in_progress" | "shipped" | "errored";

export interface UpstreamFork {
  state: UpstreamForkState;
  prUrl: string | null;
  prNumber: number | null;
  packId: string | null;
  errorMessage: string | null;
}

/**
 * Promote-to-Prod fork terminal states. Mirrors ChangePromotion.status values
 * and the A1 "awaiting_operator" return from execute_promotion.
 */
export type PromoteForkState =
  | "pending"
  | "skipped"
  | "in_progress"
  | "scheduled"
  | "awaiting_operator"
  | "shipped"
  | "rolled_back"
  | "errored";

export interface PromoteFork {
  state: PromoteForkState;
  promotionId: string | null;
  deployedAt: Date | null;
  scheduleDescription: string | null;
  rollbackReason: string | null;
  errorMessage: string | null;
}

export interface BuildFlowState {
  buildId: string;
  currentPhase: BuildPhase;
  mainTrack: MainTrackNode[];
  upstream: UpstreamFork;
  promote: PromoteFork;
  /**
   * True when every applicable fork has reached a terminal state. Drives
   * the ship → complete reconciler in reconcileBuildCompletion().
   * "Applicable" excludes forks whose state is `pending` (build hasn't
   * reached ship yet) or `skipped` — skipped forks are considered
   * dispositioned and count as terminal.
   */
  allApplicableForksTerminal: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const MAIN_TRACK_ORDER: MainTrackPhase[] = ["ideate", "plan", "build", "review", "ship"];

function asJson(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function reviewPassed(review: unknown): boolean {
  const obj = asJson(review);
  if (!obj) return false;
  const decision = typeof obj.decision === "string" ? obj.decision : "";
  return decision === "pass" || decision === "passed" || decision === "approved";
}

function countCompletedTasks(buildPlan: unknown): { done: number; total: number } {
  const plan = asJson(buildPlan);
  const tasks = plan && Array.isArray(plan.tasks) ? plan.tasks : [];
  if (tasks.length === 0) return { done: 0, total: 0 };
  const done = tasks.filter((t) => {
    const task = asJson(t);
    if (!task) return false;
    const status = typeof task.status === "string" ? task.status : "";
    return status === "done" || status === "complete" || status === "completed";
  }).length;
  return { done, total: tasks.length };
}

function countReviewChecks(verificationOut: unknown, uxTestResults: unknown): { done: number; total: number } {
  let done = 0;
  let total = 0;
  const v = asJson(verificationOut);
  if (v) {
    // Typecheck + tests + optional lint — count the booleans that exist.
    for (const key of ["typecheckPassed", "testsPassed", "lintPassed"]) {
      const val = v[key];
      if (val === true || val === false) {
        total += 1;
        if (val === true) done += 1;
      }
    }
  }
  const ux = Array.isArray(uxTestResults) ? uxTestResults : [];
  for (const step of ux) {
    const s = asJson(step);
    if (!s) continue;
    total += 1;
    const status = typeof s.status === "string" ? s.status : "";
    if (status === "passed" || status === "pass") done += 1;
  }
  return { done, total };
}

function phasePosition(phase: BuildPhase): number {
  if (phase === "complete") return MAIN_TRACK_ORDER.length; // past ship
  if (phase === "failed") return -1;
  const idx = MAIN_TRACK_ORDER.indexOf(phase as MainTrackPhase);
  return idx >= 0 ? idx : 0;
}

function nodeState(phase: MainTrackPhase, currentPhase: BuildPhase, completed: number, total: number): PhaseNodeState {
  if (currentPhase === "failed") return "failed";
  const currentIdx = phasePosition(currentPhase);
  const thisIdx = MAIN_TRACK_ORDER.indexOf(phase);
  if (currentIdx > thisIdx) return "done";
  if (currentIdx === thisIdx) return total > 0 && completed === total ? "done" : "active";
  return "pending";
}

// ─── Main derivation ────────────────────────────────────────────────────────

/**
 * Snapshot the build's flow state for UI rendering and reconciliation.
 *
 * Returns null if the build is not found. Otherwise derives every node and
 * fork state from the authoritative columns — callers never reach directly
 * into the underlying JSON blobs.
 */
export async function getBuildFlowState(buildId: string): Promise<BuildFlowState | null> {
  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
      id: true,
      buildId: true,
      phase: true,
      scoutFindings: true,
      designDoc: true,
      designReview: true,
      buildPlan: true,
      planReview: true,
      verificationOut: true,
      uxTestResults: true,
      diffPatch: true,
      productVersions: {
        select: {
          id: true,
          promotions: {
            select: {
              promotionId: true,
              status: true,
              deployedAt: true,
              rollbackReason: true,
              deploymentLog: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
        orderBy: { shippedAt: "desc" },
        take: 1,
      },
    },
  });
  if (!build) return null;

  const currentPhase = build.phase as BuildPhase;

  // ─── Main-track nodes (§3.4) ───────────────────────────────────────────
  const ideateDone =
    (build.scoutFindings ? 1 : 0) +
    (build.designDoc ? 1 : 0) +
    (reviewPassed(build.designReview) ? 1 : 0);
  const planDone =
    (asJson(build.buildPlan) && Array.isArray((asJson(build.buildPlan) as { tasks?: unknown }).tasks) ? 1 : 0) +
    (reviewPassed(build.planReview) ? 1 : 0);
  const buildCounts = countCompletedTasks(build.buildPlan);
  const reviewCounts = countReviewChecks(build.verificationOut, build.uxTestResults);
  const productVersion = build.productVersions[0] ?? null;
  const shipDone = (build.diffPatch ? 1 : 0) + (productVersion ? 1 : 0);

  const mainTrack: MainTrackNode[] = [
    {
      phase: "ideate",
      label: PHASE_LABELS.ideate,
      stepsCompleted: ideateDone,
      stepsTotal: 3,
      state: nodeState("ideate", currentPhase, ideateDone, 3),
    },
    {
      phase: "plan",
      label: PHASE_LABELS.plan,
      stepsCompleted: planDone,
      stepsTotal: 2,
      state: nodeState("plan", currentPhase, planDone, 2),
    },
    {
      phase: "build",
      label: PHASE_LABELS.build,
      stepsCompleted: buildCounts.done,
      stepsTotal: buildCounts.total,
      state: nodeState("build", currentPhase, buildCounts.done, buildCounts.total),
    },
    {
      phase: "review",
      label: PHASE_LABELS.review,
      stepsCompleted: reviewCounts.done,
      stepsTotal: reviewCounts.total,
      state: nodeState("review", currentPhase, reviewCounts.done, reviewCounts.total),
    },
    {
      phase: "ship",
      label: PHASE_LABELS.ship,
      stepsCompleted: shipDone,
      stepsTotal: 2,
      state: nodeState("ship", currentPhase, shipDone, 2),
    },
  ];

  // Ship node counts `done` once the build has advanced to complete, so the
  // ring visually fills even though currentPhase is past "ship".
  if (currentPhase === "complete") {
    const shipNode = mainTrack[4]!;
    shipNode.state = "done";
    shipNode.stepsCompleted = shipNode.stepsTotal;
  }

  // ─── Forks — only populated once the build reaches ship or beyond ──────
  const hasReachedShip = phasePosition(currentPhase) >= MAIN_TRACK_ORDER.indexOf("ship");

  const upstream = await deriveUpstreamFork(build.id, build.buildId, hasReachedShip);
  const promote = derivePromoteFork(productVersion?.promotions[0] ?? null, hasReachedShip);

  // ─── Terminal-state calculation (§3.6) ─────────────────────────────────
  // A fork "counts as terminal" if it's in any disposition other than
  // in_progress or pending. Skipped/shipped/errored/scheduled/awaiting_operator/
  // rolled_back are all terminal. in_progress blocks the transition.
  const upstreamTerminal = upstream.state !== "pending" && upstream.state !== "in_progress";
  const promoteTerminal = promote.state !== "pending" && promote.state !== "in_progress";
  const allApplicableForksTerminal = hasReachedShip && upstreamTerminal && promoteTerminal;

  return {
    buildId: build.buildId,
    currentPhase,
    mainTrack,
    upstream,
    promote,
    allApplicableForksTerminal,
  };
}

// ─── Fork derivation ────────────────────────────────────────────────────────

async function deriveUpstreamFork(
  buildRowId: string,
  humanBuildId: string,
  hasReachedShip: boolean,
): Promise<UpstreamFork> {
  if (!hasReachedShip) {
    return { state: "pending", prUrl: null, prNumber: null, packId: null, errorMessage: null };
  }

  const devConfig = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { contributionMode: true },
  });
  if (devConfig?.contributionMode === "fork_only") {
    return { state: "skipped", prUrl: null, prNumber: null, packId: null, errorMessage: null };
  }

  const pack = await prisma.featurePack.findFirst({
    where: { buildId: buildRowId },
    orderBy: { createdAt: "desc" },
    select: { packId: true, prUrl: true, prNumber: true, manifest: true },
  });

  // manifest.prUrl is the post-A2 back-write target; the top-level column is
  // the post-review-pipeline value. Prefer whichever is populated.
  const manifest = asJson(pack?.manifest);
  const manifestPrUrl = manifest && typeof manifest.prUrl === "string" ? manifest.prUrl : null;
  const manifestPrNumber = manifest && typeof manifest.prNumber === "number" ? manifest.prNumber : null;

  const prUrl = pack?.prUrl ?? manifestPrUrl ?? null;
  const prNumber = pack?.prNumber ?? manifestPrNumber ?? null;

  if (!pack) {
    // Ship reached but no pack yet — contribute_to_hive hasn't been called or
    // the user declined. Without a pack we can't tell failure from not-yet-run;
    // treat as in_progress so the UI shows the fork as pending user decision.
    return { state: "in_progress", prUrl: null, prNumber: null, packId: null, errorMessage: null };
  }

  if (prUrl) {
    return { state: "shipped", prUrl, prNumber, packId: pack.packId, errorMessage: null };
  }

  // Pack exists but no prUrl — check BuildActivity for a failure record on
  // the most recent contribute_to_hive call for this build.
  const recentFailure = await findRecentContributeFailure(humanBuildId);
  if (recentFailure) {
    return { state: "errored", prUrl: null, prNumber: null, packId: pack.packId, errorMessage: recentFailure };
  }

  return { state: "in_progress", prUrl: null, prNumber: null, packId: pack.packId, errorMessage: null };
}

async function findRecentContributeFailure(humanBuildId: string): Promise<string | null> {
  // BuildActivity.buildId references FeatureBuild.buildId (the human-readable
  // ID), not the cuid. Tool column holds the MCP tool name.
  const activity = await prisma.buildActivity.findFirst({
    where: {
      buildId: humanBuildId,
      tool: "contribute_to_hive",
    },
    orderBy: { createdAt: "desc" },
    select: { summary: true },
  });
  if (!activity?.summary) return null;
  // contribute_to_hive logs "PR FAILED: <reason>" on failure, "PR <url>" on success.
  const summary = activity.summary;
  if (/FAILED|failed|could not/i.test(summary)) {
    // Extract the reason after "FAILED:" if present.
    const match = summary.match(/FAILED[^:]*:\s*(.+?)(?:\.|$)/);
    return match ? match[1]!.trim() : summary.slice(0, 200);
  }
  return null;
}

interface PromotionRow {
  promotionId: string;
  status: string;
  deployedAt: Date | null;
  rollbackReason: string | null;
  deploymentLog: string | null;
}

function derivePromoteFork(promo: PromotionRow | null, hasReachedShip: boolean): PromoteFork {
  if (!hasReachedShip) {
    return { state: "pending", promotionId: null, deployedAt: null, scheduleDescription: null, rollbackReason: null, errorMessage: null };
  }
  if (!promo) {
    // Reached ship but no promotion record — register_digital_product_from_build
    // hasn't run. Treat as in_progress so the fork shows as unresolved.
    return { state: "in_progress", promotionId: null, deployedAt: null, scheduleDescription: null, rollbackReason: null, errorMessage: null };
  }

  const base = {
    promotionId: promo.promotionId,
    deployedAt: promo.deployedAt,
    scheduleDescription: null as string | null,
    rollbackReason: promo.rollbackReason,
    errorMessage: null as string | null,
  };

  switch (promo.status) {
    case "deployed":
      return { state: "shipped", ...base };
    case "rolled_back":
      return { state: "rolled_back", ...base, errorMessage: promo.rollbackReason };
    case "scheduled":
      return { state: "scheduled", ...base, scheduleDescription: extractScheduleDescription(promo.deploymentLog) };
    case "awaiting_operator":
      return { state: "awaiting_operator", ...base };
    case "failed":
      return { state: "errored", ...base, errorMessage: promo.deploymentLog?.slice(0, 200) ?? "Deployment failed" };
    case "pending":
    case "approved":
    case "in_progress":
    default:
      return { state: "in_progress", ...base };
  }
}

function extractScheduleDescription(deploymentLog: string | null): string | null {
  if (!deploymentLog) return null;
  // schedule_promotion writes the window description into its activity log
  // entry; the deploymentLog on ChangePromotion may or may not mirror it.
  // Return a truncated preview if present.
  return deploymentLog.slice(0, 120);
}

// ─── Reconciler (§3.6) ──────────────────────────────────────────────────────

/**
 * Advance `phase: "ship"` → `phase: "complete"` when every applicable fork
 * has reached a terminal state. Idempotent: safe to call multiple times;
 * no-op if the build is not currently in ship or the forks aren't all
 * dispositioned. Called from the fork tool sites (contribute_to_hive,
 * execute_promotion, schedule_promotion) and any ChangePromotion.status
 * update path.
 *
 * Returns true if a transition actually happened.
 */
export async function reconcileBuildCompletion(buildId: string): Promise<boolean> {
  const state = await getBuildFlowState(buildId);
  if (!state) return false;
  if (state.currentPhase !== "ship") return false;
  if (!state.allApplicableForksTerminal) return false;

  await prisma.featureBuild.update({
    where: { buildId },
    data: { phase: "complete" },
  });

  // Emit phase:change so the UI updates without a full refresh. Dynamic
  // import keeps the event bus out of the cold-path module graph.
  try {
    const { agentEventBus } = await import("@/lib/agent-event-bus");
    agentEventBus.emit(buildId, { type: "phase:change", buildId, phase: "complete" });
  } catch {
    // Event bus is best-effort — the DB transition is what matters.
  }

  return true;
}
