"use server";

/**
 * Governed customer-account merge actions (EP-4A12A7CB WG-4, spec §5.4-5.5).
 *
 * Admin-gated (mirrors the reference-data merge surface); the heavy lifting —
 * validation, snapshot, repointing, collision plans, tombstone — lives in the
 * shared orchestrator (lib/mdm/merge.ts). Preview-before-merge is mandatory
 * UX: the impact counts come from the same adapter the merge executes, so the
 * preview cannot drift from the operation.
 */
import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  MERGE_ADAPTERS,
  MergeValidationFailure,
  mergeRecords,
  type MergeResult,
} from "@/lib/mdm/merge";

type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

async function requireAdmin(): Promise<{ ok: false; message: string } | null> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_admin")
  ) {
    return { ok: false, message: "Not authorized." };
  }
  return null;
}

/** Active accounts eligible as a merge survivor (excludes self + tombstones). */
export async function listCustomerAccountMergeTargets(
  excludeId: string,
): Promise<ActionResult<Array<{ id: string; name: string; accountId: string; status: string }>>> {
  const denied = await requireAdmin();
  if (denied) return denied;
  const targets = await prisma.customerAccount.findMany({
    where: { id: { not: excludeId }, status: { not: "superseded" } },
    orderBy: { name: "asc" },
    take: 200,
    select: { id: true, name: true, accountId: true, status: true },
  });
  return { ok: true, data: targets };
}

export type MergeImpactPreview = {
  loser: { id: string; name: string; accountId: string; status: string };
  survivor: { id: string; name: string; accountId: string; status: string };
  /** Row counts that would repoint, per relation step (zero rows omitted). */
  impact: Record<string, number>;
};

/** Count affected rows per adapter step BEFORE the merge (usage-impact preview). */
export async function previewCustomerAccountMerge(
  loserId: string,
  survivorId: string,
): Promise<ActionResult<MergeImpactPreview>> {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (loserId === survivorId) return { ok: false, message: "Pick two different accounts." };

  const select = { id: true, name: true, accountId: true, status: true };
  const [loser, survivor] = await Promise.all([
    prisma.customerAccount.findUnique({ where: { id: loserId }, select }),
    prisma.customerAccount.findUnique({ where: { id: survivorId }, select }),
  ]);
  if (!loser || !survivor) return { ok: false, message: "Account not found." };
  if (loser.status === "superseded" || survivor.status === "superseded") {
    return { ok: false, message: "A superseded account cannot participate in a merge." };
  }

  const adapter = MERGE_ADAPTERS["customer-account"];
  const impact: Record<string, number> = {};
  const client = prisma as unknown as Record<string, { count: (args: unknown) => Promise<number> }>;
  for (const step of [...adapter.hardRelations, ...adapter.softReferences]) {
    const where: Record<string, unknown> = { [step.field]: loserId };
    if (step.model === "customerAccount") where["id"] = { not: loserId };
    const count = await client[step.model]!.count({ where });
    if (count > 0) impact[`${step.model}.${step.field}`] = count;
  }
  return { ok: true, data: { loser, survivor, impact } };
}

/** Execute the merge (loser → survivor) and log the audit activity. */
export async function mergeCustomerAccounts(
  loserId: string,
  survivorId: string,
): Promise<ActionResult<MergeResult>> {
  const denied = await requireAdmin();
  if (denied) return denied;

  let result: MergeResult;
  try {
    result = await mergeRecords("customer-account", loserId, survivorId);
  } catch (err) {
    if (err instanceof MergeValidationFailure) {
      return { ok: false, message: `Merge rejected: ${err.reason}.` };
    }
    throw err;
  }

  // Audit trail: the full MergeResult (snapshot + repoint counts) as a system
  // activity; coworker-path merges additionally land in ToolExecution.result.
  await prisma.activity.create({
    data: {
      activityId: `ACT-${crypto.randomUUID()}`,
      type: "account_merged",
      subject: `Account merged into survivor ${survivorId}`,
      body: JSON.stringify(result),
      accountId: survivorId,
      createdById: null,
    },
  });

  revalidatePath("/customer");
  revalidatePath(`/customer/${survivorId}`);
  return { ok: true, data: result };
}
