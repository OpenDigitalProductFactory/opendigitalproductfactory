"use server";

/**
 * Data-stewardship server actions (EP-4A12A7CB: BI-FEA49EC1 steward queue,
 * BI-28577CD1 staleness, BI-37F52B70 match tuning).
 *
 * Admin-gated (view_admin — same boundary as the reference-data and merge
 * surfaces; the dedicated mdm-steward PlatformCapability remains a follow-up
 * once the capability-seeding path is touched for other reasons). All heavy
 * lifting lives in lib/mdm/*; these actions are the governed door for the
 * /admin/data-stewardship page.
 */
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { runStewardSweep, resolveStewardTask, type StewardResolution } from "@/lib/mdm/steward";
import { mergeRecords, MergeValidationFailure, type MergeableDomain } from "@/lib/mdm/merge";
import { saveMatchConfig, matchConfigSchema, type MatchConfig } from "@/lib/mdm/match-config";
import type { DedupGatedDomain } from "@/lib/mdm/dedup-gate";

type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; message: string };

async function requireAdmin(): Promise<
  { denied: { ok: false; message: string } } | { userId: string }
> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_admin")
  ) {
    return { denied: { ok: false, message: "Not authorized." } };
  }
  return { userId: user.id ?? "admin" };
}

/** Run the duplicate + staleness sweeps and refresh the queue. */
export async function runStewardSweepAction(): Promise<
  ActionResult<Awaited<ReturnType<typeof runStewardSweep>>>
> {
  const gate = await requireAdmin();
  if ("denied" in gate) return gate.denied;
  const summary = await runStewardSweep();
  revalidatePath("/admin/data-stewardship");
  return { ok: true, data: summary };
}

/** Resolve a task without a merge (distinct / refreshed / dismissed). */
export async function resolveStewardTaskAction(
  taskId: string,
  resolution: StewardResolution,
): Promise<ActionResult> {
  const gate = await requireAdmin();
  if ("denied" in gate) return gate.denied;
  const result = await resolveStewardTask(taskId, resolution, gate.userId);
  if (!result.ok) return result;
  revalidatePath("/admin/data-stewardship");
  return { ok: true };
}

/** Merge the pair of a duplicate task (subject survives) and resolve it. */
export async function mergeStewardTaskAction(
  taskId: string,
  domain: MergeableDomain,
  survivorId: string,
  loserId: string,
): Promise<ActionResult> {
  const gate = await requireAdmin();
  if ("denied" in gate) return gate.denied;
  try {
    await mergeRecords(domain, loserId, survivorId);
  } catch (err) {
    if (err instanceof MergeValidationFailure) {
      return { ok: false, message: `Merge rejected: ${err.reason}.` };
    }
    throw err;
  }
  await resolveStewardTask(taskId, "resolved_merged", gate.userId);
  revalidatePath("/admin/data-stewardship");
  revalidatePath("/customer");
  return { ok: true };
}

/** Persist per-domain match-config overrides (validated by the shared schema). */
export async function saveMatchConfigAction(
  domain: DedupGatedDomain,
  raw: Partial<MatchConfig>,
): Promise<ActionResult<MatchConfig>> {
  const gate = await requireAdmin();
  if ("denied" in gate) return gate.denied;
  const parsed = matchConfigSchema.partial().safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: "Invalid configuration values." };
  }
  const next = await saveMatchConfig(domain, parsed.data, gate.userId);
  revalidatePath("/admin/data-stewardship");
  return { ok: true, data: next };
}
