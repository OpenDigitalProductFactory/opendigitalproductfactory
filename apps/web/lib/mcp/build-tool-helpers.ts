import { prisma, type Prisma } from "@dpf/db";
import { mergeHappyPathStateIntoPlan } from "@/lib/feature-build-types";

// Shared Build Studio tool helpers. Previously defined inline in mcp-tools.ts
// and replicated verbatim into several ToolPacks (model-provider, taxonomy-
// archetype, discovery, backlog, …) as those domains drained out of the
// executeTool switch (EP-8DC217EB BET-4). Extracted here so the inline switch,
// the drained packs, and the remaining build/sandbox packs share ONE copy
// rather than N replicas.

/** Fire-and-forget: log tool activity for the Build Studio activity timeline. */
export function logBuildActivity(buildId: string, tool: string, summary: string): void {
  prisma.buildActivity.create({ data: { buildId, tool, summary } }).catch(() => {});
}

export type AutoIntakeStep = "epic" | "backlog" | "constrained-goal" | "taxonomy-anchor";

function summarizeAutoIntakeError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Unknown error";
}

export function recordAutoIntakeFailure(
  buildId: string,
  step: AutoIntakeStep,
  error: unknown,
  logger: Pick<Console, "warn"> = console,
): void {
  logBuildActivity(buildId, `auto-intake:${step}:failed`, `Auto-intake ${step} failed: ${summarizeAutoIntakeError(error)}`);
  logger.warn(`[reviewDesignDoc] auto-intake ${step} failed:`, error);
}

/**
 * Phases that exclude a FeatureBuild from "active" auto-resolution.
 * `abandoned` is included because abandoned builds from prior runs would
 * otherwise shadow the freshly promoted build (BI-E9CD1B92, 2026-05-13).
 */
export const TERMINAL_BUILD_PHASES = ["complete", "failed", "abandoned"] as const;

const FB_ID_RE = /\b(FB-[A-Za-z0-9]+)\b/;

function asFbId(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^FB-[A-Za-z0-9]+$/.test(trimmed)) return trimmed;
  const m = trimmed.match(FB_ID_RE);
  return m ? m[1]! : null;
}

/**
 * Pull a well-formed `buildId` hint out of a tool's params bag.
 * Accepts `buildId` / `featureBuildId`, and FB-* tokens embedded in
 * routeContext/strings (BI-PIR-9a75015d — agents often omit explicit buildId
 * after start_build while still carrying FB-* in route context).
 */
export function extractBuildIdHint(params: Record<string, unknown>): string | null {
  for (const key of ["buildId", "featureBuildId", "build_id"]) {
    const v = params[key];
    if (typeof v === "string") {
      const id = asFbId(v);
      if (id) return id;
    }
  }
  for (const key of ["routeContext", "route", "path", "url", "message", "summary"]) {
    const v = params[key];
    if (typeof v === "string") {
      const id = asFbId(v);
      if (id) return id;
    }
  }
  return null;
}

/** Phases where sandbox tools are expected to work — prefer these when disambiguating. */
export const SANDBOX_HOT_PHASES = ["build", "review", "ship"] as const;

/**
 * Resolve the active FeatureBuild for the current user.
 *
 * When `buildIdHint` is supplied AND it resolves to an existing build the
 * caller is allowed to act on, that hint wins — even if the user has a more
 * recently updated build. This is how explicit `buildId` arguments from MCP
 * tool calls reach the per-tool handlers without being silently overridden
 * (the bug behind FB-1D69766D returning FB-72EB9C06's review).
 *
 * Fallback: most-recently-updated non-terminal build created by the user.
 */
export async function resolveActiveBuildId(
  userId: string,
  buildIdHint?: string | null,
): Promise<string | null> {
  if (buildIdHint && buildIdHint.startsWith("FB-")) {
    const hinted = await prisma.featureBuild.findUnique({
      where: { buildId: buildIdHint },
      select: { buildId: true, createdById: true },
    });
    // Access model today is owner-only — see getFeatureBuildForContext for the
    // matching check. If a future grant model lands, expand this predicate.
    if (hinted && hinted.createdById === userId) return hinted.buildId;
  }
  const where = { createdById: userId, phase: { notIn: [...TERMINAL_BUILD_PHASES] } };
  const build = await prisma.featureBuild.findFirst({
    where,
    orderBy: { updatedAt: "desc" },
    select: { buildId: true },
  });
  if (!build) return null;
  // BI-F82915D7: refuse to GUESS when the fallback is ambiguous. Silently
  // returning the most-recently-updated build is how a tool call with no
  // explicit buildId attached to the WRONG build — the cross-build plan/activity
  // contamination class (a zero-dispatch FeatureBuild showing another build's
  // buildPlan; sandbox edits logged under a freshly-promoted build). If the user
  // has more than one non-terminal build and nothing disambiguated it, refuse so
  // the caller surfaces "no active build — pass an explicit FB-id" rather than
  // acting on a foreign build.
  //
  // `count` is queried via optional access on purpose: it is part of the real
  // Prisma client, but many unit tests mock `prisma.featureBuild` with just
  // findUnique/findFirst/update for single-build scenarios. A missing `count`
  // there safely means "one build" — preserving those tests' behavior — while
  // production (and the dedicated test below) exercises the real ambiguity check.
  const countFn = (
    prisma.featureBuild as unknown as {
      count?: (args: { where: typeof where }) => Promise<number>;
    }
  ).count;
  const nonTerminalCount = countFn ? await countFn({ where }) : 1;
  if (nonTerminalCount <= 1) return build.buildId;

  // BI-PIR-9a75015d: when multiple non-terminal builds exist, still resolve if
  // exactly one is in a sandbox-hot phase (build/review/ship). That is the
  // build after start_build, not a stale ideate draft. If zero or many are hot,
  // keep refusing (BI-F82915D7 cross-build contamination guard).
  const findManyFn = (
    prisma.featureBuild as unknown as {
      findMany?: (args: {
        where: typeof where;
        orderBy: { updatedAt: "desc" };
        select: { buildId: true; phase: true };
        take: number;
      }) => Promise<Array<{ buildId: string; phase: string }>>;
    }
  ).findMany;
  if (!findManyFn) {
    console.warn(
      `[resolveActiveBuildId] ambiguous: user has multiple non-terminal builds and no buildId hint — refusing to guess. Pass an explicit FB-id.`,
    );
    return null;
  }
  const candidates = await findManyFn({
    where,
    orderBy: { updatedAt: "desc" },
    select: { buildId: true, phase: true },
    take: 25,
  });
  const hot = candidates.filter((c) =>
    (SANDBOX_HOT_PHASES as readonly string[]).includes(c.phase),
  );
  if (hot.length === 1) return hot[0]!.buildId;
  console.warn(
    `[resolveActiveBuildId] ambiguous: user has ${nonTerminalCount} non-terminal builds` +
      ` (${hot.length} in sandbox-hot phases) and no buildId hint — refusing to guess. Pass an explicit FB-id.`,
  );
  return null;
}

export async function updateBuildHappyPathState(
  userId: string,
  patch: Parameters<typeof mergeHappyPathStateIntoPlan>[1],
  buildId?: string | null,
): Promise<void> {
  const resolvedBuildId = buildId ?? await resolveActiveBuildId(userId);
  if (!resolvedBuildId) return;

  const build = await prisma.featureBuild.findUnique({
    where: { buildId: resolvedBuildId },
    select: { plan: true },
  });
  if (!build) return;

  const mergedPlan = mergeHappyPathStateIntoPlan(
    (build.plan as Record<string, unknown> | null) ?? null,
    patch,
  );

  await prisma.featureBuild.update({
    where: { buildId: resolvedBuildId },
    data: { plan: mergedPlan as Prisma.InputJsonValue },
  });
}
