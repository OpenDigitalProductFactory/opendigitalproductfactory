"use server";

import * as crypto from "crypto";
import {
  normalizeDiscoveredFacts,
  persistBootstrapDiscoveryRun,
  prisma,
  runBootstrapCollectors,
} from "@dpf/db";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";

async function requireManageDiscovery(): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  const user = session?.user;

  if (
    !user
    || !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "manage_provider_connections",
    )
  ) {
    return { ok: false, error: "Unauthorized" };
  }

  return { ok: true };
}

export async function triggerBootstrapDiscovery(): Promise<
  | { ok: false; error: string }
  | { ok: true; summary: Awaited<ReturnType<typeof persistBootstrapDiscoveryRun>> }
> {
  const authResult = await requireManageDiscovery();
  if (!authResult.ok) {
    return authResult;
  }

  try {
    const collected = await runBootstrapCollectors();
    const normalized = normalizeDiscoveredFacts(collected);
    const summary = await persistBootstrapDiscoveryRun(prisma as never, normalized, {
      runKey: `DISC-${crypto.randomUUID()}`,
      sourceSlug: "dpf_bootstrap",
      trigger: "manual",
    });

    revalidatePath("/inventory");
    return { ok: true, summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bootstrap discovery failed";
    return { ok: false, error: message };
  }
}
