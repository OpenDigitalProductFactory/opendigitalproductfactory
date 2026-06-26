"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import type { BuildChangeNarrative } from "@/lib/feature-build-types";

/**
 * Read-only server action backing Band 2 ("What's changing") of the Build Studio
 * overseer layer. Returns the stored plain-language change narrative for a build,
 * or null if none has been generated yet (the band then simply doesn't render).
 * BI-D93CF6C0. Mirrors the auth gate of getFeatureBuild; adds no new exposure.
 */
export async function getBuildChangeNarrativeAction(
  buildId: string,
): Promise<BuildChangeNarrative | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { changeNarrative: true },
  });

  const raw = build?.changeNarrative;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const o = raw as Record<string, unknown>;
  if (typeof o.headline !== "string" || o.headline.trim().length === 0) return null;

  return raw as unknown as BuildChangeNarrative;
}
