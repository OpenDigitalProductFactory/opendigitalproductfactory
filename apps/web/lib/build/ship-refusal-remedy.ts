// apps/web/lib/build/ship-refusal-remedy.ts
//
// BI-34A05E78 (absorbs the ship half of BI-2D30E44B): the ship reconciler used
// to retry a refused PR every hour, forever, whatever the refusal said.
// FB-533EC6E2 was refused hourly by a docs/convergence guard from 2026-11-12
// 08:26Z and then by a stale-verification preflight from 2026-11-13 06:45Z, and
// nothing changed between attempts.
//
// WWMD DI-86B6805671D7 decided the shape. Each refused attempt is classified
// and gets one bounded remedy that reuses what already exists:
//   stale-verification / verification-failed -> ship->review, where review
//       verifies the current tree again (and runs its own repair loop);
//   behind-main  -> refresh onto upstream main (BI-76BD65E6), back to review;
//   guard-finding -> ship->review->build, handing the named guards to the
//       coding agent through gauntlet repair (BI-B2EEA6DE), bound kept;
//   infrastructure / policy-hold -> wait, retrying at 1h, 2h, 4h and up to 24h;
//   unknown -> one more try, then escalate.
// Remedies that move the build are capped per build. Past a cap the build is
// escalated once (escalateBuildToHuman) and the reconciler stops retrying it.
// The publication guards are never relaxed.
//
// State is the build's own trail: one BuildActivity row per decision, tagged
// "[kind -> action]". Nothing new in the schema; the trail is already the
// record the operator reads.

export const SHIP_REFUSAL_REMEDY_TOOL = "ship_refusal_remedy";
/** Remedies that move the build (re-verify, refresh, repair) per build. */
export const SHIP_REFUSAL_MAX_REMEDIES = 3;
/** Consecutive infrastructure waits before a person is told. */
export const SHIP_REFUSAL_MAX_INFRA_WAITS = 6;
/** Consecutive unknown refusals before a person is told. */
export const SHIP_REFUSAL_MAX_UNKNOWN = 2;
const HOUR_MS = 60 * 60 * 1000;
const MAX_RETRY_MS = 24 * HOUR_MS;

export type ShipRefusalKind =
  | "stale-verification"
  | "verification-failed"
  | "behind-main"
  | "guard-finding"
  | "infrastructure"
  | "policy-hold"
  | "unknown";

export type ShipRefusal = { kind: Exclude<ShipRefusalKind, "guard-finding"> } | { kind: "guard-finding"; failedGuards: string[] };

export type ShipRefusalAction = "return-to-review" | "refresh-from-main" | "repair" | "wait" | "escalate";

export type ShipRefusalRemedy =
  | { action: "return-to-review" | "refresh-from-main" | "wait" }
  | { action: "repair"; failedGuards: string[] }
  | { action: "escalate"; reason: string };

export type ShipRefusalRecord = { kind: ShipRefusalKind; action: ShipRefusalAction };

const MOVING_ACTIONS: ReadonlySet<ShipRefusalAction> = new Set(["return-to-review", "refresh-from-main", "repair"]);
const GUARD_FAILED = /([A-Z][A-Za-z]*(?:[ -][A-Z][A-Za-z]*)* Gate)(?: \(\d+\/\d+\))? failed locally/g;

/** Classify a refusal from the text the PR attempt recorded on the trail. */
export function classifyShipRefusal(text: string): ShipRefusal {
  if (/change disposition is private|set to stay on your system|Change is kept private|Only private paths/i.test(text)) {
    return { kind: "policy-hold" };
  }
  // A named guard is a concrete finding, so it outranks any noise around it.
  const guards = [...new Set([...text.matchAll(GUARD_FAILED)].map((m) => m[1]))];
  if (guards.length > 0) return { kind: "guard-finding", failedGuards: guards };
  if (/source is (?:not promotable|diverged)|requires pause|missing \d+ commits/i.test(text)) return { kind: "behind-main" };
  if (/exited 137|sandbox (?:is )?unavailable|rate limit|HTTP (?:403|429|50\d)|status (?:403|429|50\d)|ECONNRESET|ETIMEDOUT|fetch failed|could not complete|no machine-readable verdict|No GitHub token/i.test(text)) {
    return { kind: "infrastructure" };
  }
  if (/Verification has not passed for this exact change|No verification record could be matched|exact version of this change could not be identified/i.test(text)) {
    return { kind: "stale-verification" };
  }
  if (/TypeCheck did not pass|test\(s\) failed|acceptance criteri(?:on|a) remain unmet|No acceptance criteria were recorded/i.test(text)) {
    return { kind: "verification-failed" };
  }
  return { kind: "unknown" };
}

function trailingRun(history: readonly ShipRefusalRecord[], kind: ShipRefusalKind): number {
  let n = 0;
  for (let i = history.length - 1; i >= 0 && history[i].kind === kind && history[i].action === "wait"; i--) n++;
  return n;
}

/** Pure: what to do about this refusal, given every decision already taken for the build. */
export function decideShipRefusalRemedy(refusal: ShipRefusal, history: readonly ShipRefusalRecord[]): ShipRefusalRemedy {
  const spent = history.filter((r) => MOVING_ACTIONS.has(r.action)).length;
  const moving = (remedy: ShipRefusalRemedy): ShipRefusalRemedy => spent >= SHIP_REFUSAL_MAX_REMEDIES
    ? { action: "escalate", reason: `${SHIP_REFUSAL_MAX_REMEDIES} automatic remedies did not get the PR open; the last refusal was ${refusal.kind}.` }
    : remedy;
  switch (refusal.kind) {
    case "stale-verification":
    case "verification-failed":
      return moving({ action: "return-to-review" });
    case "behind-main":
      return moving({ action: "refresh-from-main" });
    case "guard-finding":
      return moving({ action: "repair", failedGuards: refusal.failedGuards });
    case "infrastructure":
      return trailingRun(history, "infrastructure") >= SHIP_REFUSAL_MAX_INFRA_WAITS
        ? { action: "escalate", reason: `The PR attempt failed on infrastructure ${SHIP_REFUSAL_MAX_INFRA_WAITS + 1} times in a row.` }
        : { action: "wait" };
    case "policy-hold":
      // The owner's decision is already in front of them; asking again adds nothing.
      return { action: "wait" };
    case "unknown":
      return trailingRun(history, "unknown") + 1 >= SHIP_REFUSAL_MAX_UNKNOWN
        ? { action: "escalate", reason: `The PR attempt was refused ${SHIP_REFUSAL_MAX_UNKNOWN} times in a row for a reason no remedy covers.` }
        : { action: "wait" };
  }
}

/** Hourly, doubling for each consecutive wait on the same refusal, up to a day. */
export function shipPrRetryIntervalMs(history: readonly ShipRefusalRecord[]): number {
  const last = history[history.length - 1];
  if (!last || last.action !== "wait") return HOUR_MS;
  return Math.min(HOUR_MS * 2 ** trailingRun(history, last.kind), MAX_RETRY_MS);
}

const RECORD_TAG = /^\[([a-z-]+) -> ([a-z-]+)\]/;
const KINDS: ReadonlySet<string> = new Set(["stale-verification", "verification-failed", "behind-main", "guard-finding", "infrastructure", "policy-hold", "unknown"]);
const ACTIONS: ReadonlySet<string> = new Set(["return-to-review", "refresh-from-main", "repair", "wait", "escalate"]);

export function parseShipRefusalRecord(summary: string): ShipRefusalRecord | null {
  const m = RECORD_TAG.exec(summary);
  if (!m || !KINDS.has(m[1]) || !ACTIONS.has(m[2])) return null;
  return { kind: m[1] as ShipRefusalKind, action: m[2] as ShipRefusalAction };
}

export type ShipRefusalRemedyDeps = {
  /** This build's earlier decisions, oldest first. */
  history(buildId: string): Promise<ShipRefusalRecord[]>;
  /** The refusal the last PR attempt recorded, or null when it was not refused. */
  lastRefusal(buildId: string): Promise<{ summary: string; at: Date } | null>;
  /** Guarded ship->review flip; keeps the gauntlet repair bound. False when no longer in ship. */
  returnToReview(buildId: string): Promise<boolean>;
  queueReview(buildId: string): Promise<void>;
  /** Refresh onto upstream main; true when the build left ship for review. */
  refreshFromMain(buildId: string): Promise<boolean>;
  routeToRepair(buildId: string, failedGuards: string[], detail: string): Promise<string>;
  escalate(buildId: string, reason: string, detail: string): Promise<void>;
  record(buildId: string, summary: string): Promise<void>;
};

export type ShipRefusalOutcome = ShipRefusalAction | "none";

/** Act on the last refusal. Returns the action taken; anything but wait/none moved the build. */
export async function remedyRefusedShipBuild(
  buildId: string,
  deps: ShipRefusalRemedyDeps = defaultDeps(),
): Promise<ShipRefusalOutcome> {
  const refused = await deps.lastRefusal(buildId);
  if (!refused) return "none";
  const refusal = classifyShipRefusal(refused.summary);
  const history = await deps.history(buildId);
  const remedy = decideShipRefusalRemedy(refusal, history);
  const tag = `[${refusal.kind} -> ${remedy.action}]`;
  const detail = refused.summary.replace(/^Pull request not opened;\s*/, "").slice(0, 600);

  if (remedy.action === "wait") {
    const next = shipPrRetryIntervalMs([...history, { kind: refusal.kind, action: "wait" }]);
    await deps.record(buildId, `${tag} No remedy moves this build; the next PR attempt is in ${Math.round(next / HOUR_MS)}h. ${detail}`);
    return "wait";
  }
  if (remedy.action === "escalate") {
    await deps.record(buildId, `${tag} ${remedy.reason} Escalated to a person; the PR is not retried again. ${detail}`);
    await deps.escalate(buildId, remedy.reason, detail);
    return "escalate";
  }
  if (remedy.action === "refresh-from-main") {
    const moved = await deps.refreshFromMain(buildId);
    await deps.record(buildId, `${tag} ${moved ? "Refreshed onto upstream main and returned to review." : "The refresh did not complete; its own trail says why."} ${detail}`);
    return moved ? "refresh-from-main" : "wait";
  }
  if (!(await deps.returnToReview(buildId))) return "none";
  if (remedy.action === "repair") {
    const routed = await deps.routeToRepair(buildId, remedy.failedGuards, detail);
    if (routed !== "repair-queued" && routed !== "escalated") await deps.queueReview(buildId);
    await deps.record(buildId, `${tag} Returned to review and handed ${remedy.failedGuards.join(", ")} to the coding agent (${routed}). ${detail}`);
    return "repair";
  }
  await deps.queueReview(buildId);
  await deps.record(buildId, `${tag} Returned to review so the current tree is verified again before the PR is retried. ${detail}`);
  return "return-to-review";
}

/** The ship reconciler's read of this build's decisions, oldest first. */
export async function loadShipRefusalHistory(buildId: string): Promise<ShipRefusalRecord[]> {
  return defaultDeps().history(buildId);
}

function defaultDeps(): ShipRefusalRemedyDeps {
  const db = async () => (await import("@dpf/db")).prisma;
  return {
    async history(buildId) {
      const rows = await (await db()).buildActivity.findMany({
        where: { buildId, tool: SHIP_REFUSAL_REMEDY_TOOL },
        orderBy: { createdAt: "asc" },
        select: { summary: true },
      });
      return rows.map((r) => parseShipRefusalRecord(r.summary)).filter((r): r is ShipRefusalRecord => r !== null);
    },
    async lastRefusal(buildId) {
      const prisma = await db();
      const row = await prisma.buildActivity.findFirst({
        where: { buildId, tool: "auto_open_pr" },
        orderBy: { createdAt: "desc" },
        select: { summary: true, createdAt: true },
      });
      if (!row || !row.summary.startsWith("Pull request not opened")) return null;
      // The attempt's own readiness line carries the untruncated guard names.
      const readiness = await prisma.buildActivity.findFirst({
        where: {
          buildId,
          tool: { contains: "readiness:" }, // the attempt's readiness verdict row
          createdAt: { gte: new Date(row.createdAt.getTime() - 10 * 60 * 1000), lte: row.createdAt },
        },
        orderBy: { createdAt: "desc" },
        select: { summary: true },
      });
      return { summary: readiness ? `${row.summary}\n${readiness.summary}` : row.summary, at: row.createdAt };
    },
    async returnToReview(buildId) {
      const { Prisma } = await import("@dpf/db");
      const prisma = await db();
      const build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { verificationOut: true } });
      const repair = (build?.verificationOut as { gauntletRepair?: unknown } | null)?.gauntletRepair;
      const flipped = await prisma.featureBuild.updateMany({
        where: { buildId, phase: "ship" },
        data: {
          phase: "review",
          acceptanceMet: Prisma.DbNull,
          verificationOut: repair ? ({ gauntletRepair: repair } as never) : Prisma.DbNull,
          uxVerificationStatus: null,
        },
      });
      return flipped.count > 0;
    },
    async queueReview(buildId) {
      const { queueBuildReviewVerification } = await import("@/lib/build-review-verification-trigger");
      await queueBuildReviewVerification(buildId);
    },
    async refreshFromMain(buildId) {
      const { refreshDivergedShipBuild } = await import("./ship-source-refresh");
      return (await refreshDivergedShipBuild(buildId, undefined, { force: true })) === "returned-to-review";
    },
    async routeToRepair(buildId, failedGuards, detail) {
      const { routeGauntletFailureToRepair } = await import("./gauntlet-repair");
      return routeGauntletFailureToRepair(buildId, {
        treeSha: null,
        recordId: null,
        failedGuards,
        source: "guards",
        findings: [{ severity: "important", description: detail }],
      });
    },
    async escalate(buildId, reason, detail) {
      const prisma = await db();
      const build = await prisma.featureBuild.findUnique({
        where: { buildId },
        select: { id: true, title: true, originatingBacklogItemId: true },
      });
      if (!build) return;
      const { escalateBuildToHuman } = await import("./escalate-build-to-human");
      await escalateBuildToHuman({
        buildPk: build.id,
        buildId,
        featureTitle: build.title,
        originatingBacklogItemId: build.originatingBacklogItemId,
        phase: "ship",
        rounds: SHIP_REFUSAL_MAX_REMEDIES,
        issues: [{ severity: "important", description: `${reason} Last refusal: ${detail}` }],
        log: async (summary) => {
          await prisma.buildActivity.create({ data: { buildId, tool: SHIP_REFUSAL_REMEDY_TOOL, summary: summary.slice(0, 1000) } });
        },
      });
    },
    async record(buildId, summary) {
      await (await db()).buildActivity.create({ data: { buildId, tool: SHIP_REFUSAL_REMEDY_TOOL, summary: summary.slice(0, 1000) } }).catch(() => {});
    },
  };
}
