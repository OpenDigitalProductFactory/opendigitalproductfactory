"use server";

// Account hygiene actions (BI-15AC1B33). The CRM account detail page previously
// exposed only "Merge into…", so a mislabeled prospect or a fabricated deal
// could not be corrected in the UI. These governed, audited writes give the
// operator direct account hygiene without touching the database. All take the
// CRM authority `operate_customer`. Extracted from crm.ts to keep that module
// focused (module-size guard).

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { CUSTOMER_ACCOUNT_STATUSES } from "@dpf/db/customer-lifecycle";
import { requireCapability } from "./shared/guards";
import { recordLifecycleTransition } from "@/lib/lifecycle/lifecycle-transition";
import { resolveCustomerAccountPoint } from "@/lib/lifecycle-grammars";
import { logSystemActivity } from "@/lib/crm/crm-activity";
import { customerAccountNormalizedColumns } from "@/lib/mdm/dedup-gate";

// Operator-settable account statuses. `superseded` is reserved for the merge
// tombstone (set only by mergeCustomerAccounts); `archived` has its own action
// below, so it is not offered as a free-form status change.
const OPERATOR_SETTABLE_ACCOUNT_STATUSES = CUSTOMER_ACCOUNT_STATUSES.filter(
  (s) => s !== "superseded" && s !== "archived",
) as string[];

export async function updateCustomerAccount(input: {
  accountId: string;
  name?: string;
  status?: string;
  industry?: string | null;
  website?: string | null;
  notes?: string | null;
}) {
  await requireCapability("operate_customer");

  const existing = await prisma.customerAccount.findUnique({
    where: { id: input.accountId },
    select: { id: true, name: true, status: true, website: true },
  });
  if (!existing) throw new Error("Account not found.");
  if (existing.status === "superseded") {
    throw new Error("A merged account cannot be edited. Unmerge it first.");
  }

  const nextName = input.name?.trim();
  if (input.name !== undefined && !nextName) {
    throw new Error("Account name cannot be empty.");
  }
  if (
    input.status !== undefined &&
    !OPERATOR_SETTABLE_ACCOUNT_STATUSES.includes(input.status)
  ) {
    throw new Error(`Invalid account status "${input.status}".`);
  }

  const nextWebsite =
    input.website === undefined ? undefined : input.website?.trim() || null;

  // PATCH semantics — only touch fields the caller supplied. Re-derive the MDM
  // dedup normalization columns whenever name or website changes.
  const nameOrWebsiteChanged = nextName !== undefined || nextWebsite !== undefined;
  const updated = await prisma.customerAccount.update({
    where: { id: existing.id },
    data: {
      ...(nextName !== undefined ? { name: nextName } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.industry !== undefined ? { industry: input.industry?.trim() || null } : {}),
      ...(nextWebsite !== undefined ? { website: nextWebsite } : {}),
      ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      ...(nameOrWebsiteChanged
        ? customerAccountNormalizedColumns({
            name: nextName ?? existing.name,
            website: nextWebsite === undefined ? existing.website : nextWebsite,
          })
        : {}),
    },
  });

  const statusChanged = input.status !== undefined && input.status !== existing.status;
  if (statusChanged) {
    // Record the operator's lifecycle transition on the universal ledger with the in-stage
    // state axis (two-axis reporting). Authoritative: the operator holds operate_customer and
    // may set any settable status, so this is not gated by grammar readiness.
    await recordLifecycleTransition({
      governedThingKind: "CustomerAccount",
      governedThingId: updated.id,
      from: resolveCustomerAccountPoint(existing.status),
      to: resolveCustomerAccountPoint(input.status as string),
      reason: `Operator changed account status ${existing.status} → ${input.status}`,
      authoritative: true,
    });
  }
  await logSystemActivity(
    statusChanged
      ? `Account "${updated.name}" status changed from ${existing.status} to ${input.status}`
      : `Account "${updated.name}" details updated`,
    { type: statusChanged ? "status_change" : "note", accountId: updated.id },
  );

  revalidatePath("/customer");
  revalidatePath(`/customer/${existing.id}`);
  return updated;
}

export async function archiveCustomerAccount(input: {
  accountId: string;
  reason?: string;
}) {
  await requireCapability("operate_customer");

  const existing = await prisma.customerAccount.findUnique({
    where: { id: input.accountId },
    select: { id: true, name: true, status: true },
  });
  if (!existing) throw new Error("Account not found.");
  if (existing.status === "superseded") {
    throw new Error("A merged account is already tombstoned; it cannot be archived.");
  }
  if (existing.status === "archived") return existing;

  const updated = await prisma.customerAccount.update({
    where: { id: existing.id },
    data: { status: "archived" },
  });

  await logSystemActivity(
    `Account "${existing.name}" archived${input.reason ? `: ${input.reason}` : ""}`,
    { type: "status_change", accountId: existing.id },
  );

  revalidatePath("/customer");
  revalidatePath(`/customer/${existing.id}`);
  return updated;
}

// Remove an opportunity entirely. FK-safe: a quote requires its opportunity
// (Restrict), so refuse when quotes exist and direct the operator to void those
// first; Activity.opportunityId is optional, so its links are cleared in the
// same transaction. The removal is audited on the account timeline.
export async function removeOpportunity(input: {
  opportunityId: string;
  reason?: string;
}) {
  await requireCapability("operate_customer");

  const opp = await prisma.opportunity.findUnique({
    where: { id: input.opportunityId },
    select: {
      id: true,
      title: true,
      accountId: true,
      _count: { select: { quotes: true } },
    },
  });
  if (!opp) throw new Error("Opportunity not found.");
  if (opp._count.quotes > 0) {
    throw new Error(
      "This opportunity has quotes. Void those quotes first, then remove the opportunity.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.activity.updateMany({
      where: { opportunityId: opp.id },
      data: { opportunityId: null },
    });
    await tx.opportunity.delete({ where: { id: opp.id } });
  });

  await logSystemActivity(
    `Opportunity "${opp.title}" removed${input.reason ? `: ${input.reason}` : ""}`,
    { type: "status_change", accountId: opp.accountId },
  );

  revalidatePath(`/customer/${opp.accountId}`);
  return { ok: true as const, accountId: opp.accountId };
}

// Cancel a subscription/support contract. Soft state change to `cancelled`
// (audit matters for revenue history), never a hard delete.
export async function cancelSubscription(input: {
  subscriptionId: string;
  reason?: string;
}) {
  await requireCapability("operate_customer");

  const sub = await prisma.subscription.findUnique({
    where: { id: input.subscriptionId },
    select: { id: true, subscriptionRef: true, accountId: true, status: true },
  });
  if (!sub) throw new Error("Subscription not found.");
  if (sub.status === "cancelled") return sub;

  const updated = await prisma.subscription.update({
    where: { id: sub.id },
    data: { status: "cancelled" },
  });

  await logSystemActivity(
    `Subscription ${sub.subscriptionRef} cancelled${input.reason ? `: ${input.reason}` : ""}`,
    { type: "status_change", accountId: sub.accountId ?? undefined },
  );

  if (sub.accountId) revalidatePath(`/customer/${sub.accountId}`);
  return updated;
}
