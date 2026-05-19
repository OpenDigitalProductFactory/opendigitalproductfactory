"use server";

import { auth } from "@/lib/auth";
import { getBuildProgressVisibility, type BuildProgressVisibility } from "@/lib/build/progress-visibility";

export async function getBuildProgressVisibilityAction(buildId: string): Promise<BuildProgressVisibility | null> {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  return getBuildProgressVisibility(buildId);
}
