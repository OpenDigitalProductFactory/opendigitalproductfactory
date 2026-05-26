"use server";

// apps/web/lib/actions/decomposition-actions.ts
//
// Phase 4c/8 — operator-facing server actions for the design-time
// decomposition flow. The slide-over UI, amendment panel, and banner CTAs
// call these instead of the MCP layer directly, so the human path has the
// same business-logic surface as the agent path but with
// `can(... "manage_backlog")` instead of the AgentGrant capability check.
//
// Spec: docs/superpowers/specs/2026-05-24-build-studio-design-time-decomposition-design.md
// BI: BI-2E6CC391.
//
// Each action wraps the corresponding lib/build/ module:
//   - proposeBuildDecompositionAction → proposeDecomposition (4b)
//   - approveDecompositionAction      → approveDecomposition (4a)
//   - recordDecompositionOverrideAction → recordDecompositionOverride (4a)
//   - amendParentDesignAction → amendEpicDecomposition (8)
//
// Result shape mirrors the lib module's discriminated union so the client
// component can pattern-match on ok + code.

import { revalidatePath } from "next/cache";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";

import {
  approveDecomposition,
  type ApproveDecompositionResult,
} from "@/lib/build/approve-decomposition";
import {
  amendEpicDecomposition,
  coerceBuildDesignDoc,
  type AmendEpicDecompositionResult,
} from "@/lib/build/amend-epic-decomposition";
import type { DecompositionCandidate } from "@/lib/build/decomposition-candidates";
import {
  proposeDecomposition,
  type ProposeDecompositionResult,
} from "@/lib/build/propose-decomposition";
import {
  recordDecompositionOverride,
  type RecordDecompositionOverrideResult,
} from "@/lib/build/decomposition-override";
import type { BuildDesignDoc, BuildPhase } from "@/lib/explore/feature-build-types";

// ─── Auth helper ─────────────────────────────────────────────────────────────

async function requireManageBacklog(): Promise<{ userId: string }> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "manage_backlog",
    )
  ) {
    throw new Error("Unauthorized");
  }
  return { userId: user.id! };
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export async function proposeBuildDecompositionAction(args: {
  buildId: string;
  operatorHint?: string;
}): Promise<ProposeDecompositionResult> {
  const { userId } = await requireManageBacklog();
  const result = await proposeDecomposition({
    buildId: args.buildId,
    userId,
    ...(args.operatorHint ? { operatorHint: args.operatorHint } : {}),
  });
  // Refresh the build detail surface so the new candidates render on the
  // server-rendered review panel without a manual reload.
  if (result.ok) {
    revalidatePath(`/build/${args.buildId}`);
  }
  return result;
}

export async function approveDecompositionAction(args: {
  buildId: string;
  candidate: DecompositionCandidate;
}): Promise<ApproveDecompositionResult> {
  const { userId } = await requireManageBacklog();
  const result = await approveDecomposition({
    buildId: args.buildId,
    candidate: args.candidate,
    userId,
  });
  if (result.ok) {
    // Approval atomically supersedes the originating build and creates the
    // Epic + children — the list and detail surfaces both need refresh.
    revalidatePath(`/build/${args.buildId}`);
    revalidatePath("/build");
  }
  return result;
}

export async function recordDecompositionOverrideAction(args: {
  buildId: string;
  rationale: string;
}): Promise<RecordDecompositionOverrideResult> {
  const { userId } = await requireManageBacklog();
  const result = await recordDecompositionOverride({
    buildId: args.buildId,
    rationale: args.rationale,
    userId,
  });
  if (result.ok) {
    revalidatePath(`/build/${args.buildId}`);
  }
  return result;
}

export type ParentDesignAmendmentContextResult =
  | {
      ok: true;
      currentChildBuildId: string;
      parentEpic: {
        epicId: string;
        title: string;
        designDoc: BuildDesignDoc;
      };
      children: Array<{
        buildId: string;
        title: string;
        phase: BuildPhase;
        childOrder: number | null;
      }>;
    }
  | {
      ok: false;
      code:
        | "child-build-not-found"
        | "build-has-no-parent-epic"
        | "parent-epic-missing-design-doc";
      error: string;
    };

export type AmendParentDesignActionResult =
  | AmendEpicDecompositionResult
  | {
      ok: false;
      code: "child-build-not-found" | "build-has-no-parent-epic";
      error: string;
    };

export async function getParentDesignAmendmentContextAction(args: {
  childBuildId: string;
}): Promise<ParentDesignAmendmentContextResult> {
  await requireManageBacklog();
  const child = await prisma.featureBuild.findUnique({
    where: { buildId: args.childBuildId },
    select: {
      buildId: true,
      parentEpic: {
        select: {
          epicId: true,
          title: true,
          designDoc: true,
          featureBuilds: {
            orderBy: [{ childOrder: "asc" }, { buildId: "asc" }],
            select: {
              buildId: true,
              title: true,
              phase: true,
              childOrder: true,
            },
          },
        },
      },
    },
  });

  if (!child) {
    return {
      ok: false,
      code: "child-build-not-found",
      error: `FeatureBuild ${args.childBuildId} was not found.`,
    };
  }
  if (!child.parentEpic) {
    return {
      ok: false,
      code: "build-has-no-parent-epic",
      error: "Only child builds can amend an execution-organizational parent Epic.",
    };
  }

  const designDoc = coerceBuildDesignDoc(child.parentEpic.designDoc);
  if (!designDoc) {
    return {
      ok: false,
      code: "parent-epic-missing-design-doc",
      error: `Parent Epic ${child.parentEpic.epicId} does not have a designDoc to amend.`,
    };
  }

  return {
    ok: true,
    currentChildBuildId: child.buildId,
    parentEpic: {
      epicId: child.parentEpic.epicId,
      title: child.parentEpic.title,
      designDoc,
    },
    children: child.parentEpic.featureBuilds.map((build) => ({
      buildId: build.buildId,
      title: build.title,
      phase: build.phase as BuildPhase,
      childOrder: build.childOrder,
    })),
  };
}

export async function amendParentDesignAction(args: {
  childBuildId: string;
  proposedDesignDoc: BuildDesignDoc;
  rationale: string;
}): Promise<AmendParentDesignActionResult> {
  const { userId } = await requireManageBacklog();
  const child = await prisma.featureBuild.findUnique({
    where: { buildId: args.childBuildId },
    select: {
      buildId: true,
      parentEpic: {
        select: {
          epicId: true,
        },
      },
    },
  });

  if (!child) {
    return {
      ok: false,
      code: "child-build-not-found",
      error: `FeatureBuild ${args.childBuildId} was not found.`,
    };
  }
  if (!child.parentEpic) {
    return {
      ok: false,
      code: "build-has-no-parent-epic",
      error: "Only child builds can amend an execution-organizational parent Epic.",
    };
  }

  const result = await amendEpicDecomposition({
    epicId: child.parentEpic.epicId,
    proposedDesignDoc: args.proposedDesignDoc,
    rationale: args.rationale,
    userId,
  });

  if (result.ok) {
    revalidatePath(`/build/${args.childBuildId}`);
    revalidatePath("/build");
  }
  return result;
}
