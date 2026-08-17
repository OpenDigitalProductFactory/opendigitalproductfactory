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
  UnmergeValidationFailure,
  mergeRecords,
  unmergeRecords,
  type MergeResult,
  type UnmergeResult,
} from "@/lib/mdm/merge";
import { ok, err, type ActionResult } from "@/lib/shared/action-result";

async function requireAdmin(): Promise<{ ok: false; error: string } | null> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_admin")
  ) {
    return err("Not authorized.");
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
  return ok(targets);
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
  if (loserId === survivorId) return err("Pick two different accounts.");

  const select = { id: true, name: true, accountId: true, status: true };
  const [loser, survivor] = await Promise.all([
    prisma.customerAccount.findUnique({ where: { id: loserId }, select }),
    prisma.customerAccount.findUnique({ where: { id: survivorId }, select }),
  ]);
  if (!loser || !survivor) return err("Account not found.");
  if (loser.status === "superseded" || survivor.status === "superseded") {
    return err("A superseded account cannot participate in a merge.");
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
  return ok({ loser, survivor, impact });
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
  } catch (e) {
    if (e instanceof MergeValidationFailure) {
      return err(`Merge rejected: ${e.reason}.`);
    }
    throw e;
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
  return ok(result);
}

/** Reverse a merge from the tombstone (admin; lineage-based, BI-F7B6D55E). */
export async function unmergeCustomerAccounts(
  loserId: string,
): Promise<ActionResult<UnmergeResult>> {
  const denied = await requireAdmin();
  if (denied) return denied;

  let result: UnmergeResult;
  try {
    result = await unmergeRecords(loserId);
  } catch (e) {
    if (e instanceof UnmergeValidationFailure) {
      const why: Record<string, string> = {
        "not-merged": "This account is not a merge tombstone.",
        "no-audit": "No merge audit record found — cannot restore safely.",
        "lossy-lineage": "The merge moved more rows than the lineage cap records — manual restore required.",
        "survivor-mismatch": "The tombstone does not match the audit record.",
      };
      return err(why[e.reason] ?? `Unmerge rejected: ${e.reason}.`);
    }
    throw e;
  }

  await prisma.activity.create({
    data: {
      activityId: `ACT-${crypto.randomUUID()}`,
      type: "account_unmerged",
      subject: `Merge reversed — account ${loserId} restored from ${result.survivorId}`,
      body: JSON.stringify(result),
      accountId: loserId,
      createdById: null,
    },
  });

  revalidatePath("/customer");
  revalidatePath(`/customer/${loserId}`);
  revalidatePath(`/customer/${result.survivorId}`);
  return ok(result);
}
