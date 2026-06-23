"use server";
// EP-GOLDEN-TRIANGLE Slice 4 (BI-85B2E96C) — server action to save the WWMD /
// platform default posture. Gated by `view_platform` (the same capability that
// guards decision-perspective writes). Platform scope only for v1; org-scoped
// (WWWD) saving needs org-membership authz and lands with Slice 5.
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import type { GoldenTrianglePreference } from "@/lib/golden-triangle";
import { setGoldenTrianglePosture } from "@/lib/golden-triangle/persistence";

export async function saveGoldenTrianglePlatformDefault(
  preference: GoldenTrianglePreference,
): Promise<{ ok: boolean }> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_platform")) {
    throw new Error("Unauthorized");
  }
  const ok = await setGoldenTrianglePosture({ kind: "platform" }, preference);
  if (ok) revalidatePath("/platform/ai/priority");
  return { ok };
}
