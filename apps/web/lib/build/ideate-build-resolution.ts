// apps/web/lib/build/ideate-build-resolution.ts
//
// BI-F4A30FCB (Dale dogfood 2026-05-24).
//
// Resolves the build that an ideate-phase tool (start_ideate_research,
// start_scout_research, ...) should act on.
//
// The prior pattern was
//   prisma.featureBuild.findFirst({
//     where: { phase: "ideate" },
//     orderBy: { updatedAt: "desc" },
//   })
// which silently cross-contaminates state when multiple builds are in ideate
// concurrently — the user's request landed on whichever unrelated build's
// `updatedAt` was most recent. The bug hid behind a `success: true` response
// so neither the user nor the agent had any way to see the mismatch.
//
// Resolution order:
//   1. Explicit `contextBuildId` from the agent's `featureBuildId` — verify
//      the build exists AND is currently in ideate; reject otherwise.
//   2. No explicit buildId AND exactly one ideate-phase build exists →
//      assume that build (single-operator, single-build case).
//   3. No explicit buildId AND 0 or 2+ ideate builds → refuse with a clear,
//      operator-actionable error rather than silently mis-targeting.
//
// Lives in its own file (rather than inline in mcp-tools.ts) so the
// regression tests can mock Prisma without dragging in mcp-tools.ts's full
// import surface.

// Mirror of ToolResult from mcp-tools.ts (kept inline to avoid pulling that
// file's full import surface into the regression test).
type ToolResult = {
  success: boolean;
  entityId?: string;
  message: string;
  error?: string;
  data?: Record<string, unknown>;
};

export type IdeateBuildResolverDeps = {
  findUniqueBuild: (buildId: string) => Promise<{ buildId: string; phase: string } | null>;
  findIdeateBuilds: () => Promise<Array<{ buildId: string }>>;
};

export type IdeateBuildResolution =
  | { build: { buildId: string }; refusal?: never }
  | { build: null; refusal: ToolResult };

export async function resolveIdeateBuildForToolPure(
  args: { contextBuildId?: string; toolName: string },
  deps: IdeateBuildResolverDeps,
): Promise<IdeateBuildResolution> {
  // Path 1: explicit buildId from agent context.
  if (args.contextBuildId) {
    const explicit = await deps.findUniqueBuild(args.contextBuildId);
    if (!explicit) {
      return {
        build: null,
        refusal: {
          success: false,
          message:
            "Couldn't find that build to start research on. The system may have removed or renamed it — try selecting a build from the list and asking again.",
        },
      };
    }
    if (explicit.phase !== "ideate") {
      return {
        build: null,
        refusal: {
          success: false,
          message:
            `That build has already moved past the planning conversation — it's now in the ${explicit.phase} phase. Research is only started during the planning conversation. Pick a build that's still in planning, or continue the work this build is currently in.`,
        },
      };
    }
    return { build: { buildId: explicit.buildId } };
  }

  // Path 2 / 3: no explicit buildId — only accept the implicit "latest"
  // when exactly one ideate-phase build exists.
  const ideateBuilds = await deps.findIdeateBuilds();
  if (ideateBuilds.length === 0) {
    return {
      build: null,
      refusal: {
        success: false,
        message:
          "There isn't a planning conversation open right now. Start a new feature first, then ask me to research it.",
      },
    };
  }
  if (ideateBuilds.length === 1) {
    return { build: { buildId: ideateBuilds[0]!.buildId } };
  }

  // 2+ ideate builds and no explicit buildId. This means the agentic loop
  // didn't pipe featureBuildId into the tool context. Log + refuse so the
  // failure is loud rather than silent (this is the exact symptom Dale's
  // dogfood surfaced — concurrent ideate builds cross-contaminating).
  console.warn(
    `[ideate-build-resolution] ${args.toolName} called without context.featureBuildId while ${ideateBuilds.length} builds are in ideate. ` +
      "Cannot pick the correct target — refusing rather than silently mis-targeting. " +
      "Fix: ensure runAgenticLoop.featureBuildId flows into the tool context (see agentic-loop.ts → governedExecuteTool).",
  );
  return {
    build: null,
    refusal: {
      success: false,
      message:
        "I couldn't tell which build you wanted me to research — the system is processing several feature conversations right now. Open the specific feature you want and ask again from inside it.",
    },
  };
}
