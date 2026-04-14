"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { runTraversalPattern as executeTraversal } from "@/lib/ea/traversal-executor";

async function requireEaAccess(): Promise<void> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_ea_modeler")
  ) {
    throw new Error("Unauthorized");
  }
}

export type TraversalPatternInfo = {
  slug: string;
  name: string;
  description: string | null;
  patternType: string;
};

export async function getTraversalPatterns(
  notationSlug: string,
): Promise<TraversalPatternInfo[]> {
  await requireEaAccess();

  const notation = await prisma.eaNotation.findUnique({
    where: { slug: notationSlug },
    select: { id: true },
  });
  if (!notation) return [];

  const patterns = await prisma.eaTraversalPattern.findMany({
    where: { notationId: notation.id, status: "active" },
    orderBy: { name: "asc" },
    select: {
      slug: true,
      name: true,
      description: true,
      patternType: true,
    },
  });

  return patterns;
}

export type TraversalRunResult = {
  ok: boolean;
  error?: string;
  paths?: Array<{ label: string; complete: boolean }>;
  summary?: {
    nodesTraversed: number;
    relationshipsFollowed: number;
    refinementGaps: string[];
  };
};

export async function runTraversal(input: {
  patternSlug: string;
  startElementIds: string[];
  notationSlug: string;
}): Promise<TraversalRunResult> {
  await requireEaAccess();

  const result = await executeTraversal({
    patternSlug: input.patternSlug,
    startElementIds: input.startElementIds,
    notationSlug: input.notationSlug,
  });

  if (!result.ok || !result.data) {
    return { ok: false, error: result.error ?? "Traversal failed" };
  }

  const paths = result.data.paths.map((p) => ({
    label: p.steps.map((s) => s.elementName).join(" -> "),
    complete: p.complete,
  }));

  return {
    ok: true,
    paths,
    summary: {
      nodesTraversed: result.data.summary.nodesTraversed,
      relationshipsFollowed: result.data.summary.relationshipsFollowed,
      refinementGaps: result.data.summary.refinementGaps,
    },
  };
}
