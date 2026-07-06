// apps/web/lib/actions/labor.ts — server actions for the billable-time surfaces
// (EP-LABOR-ECONOMICS Phase 4): the BillableRate rate card and turning a
// customer's approved billable hours into a draft invoice. The billing rules
// live in lib/hr/labor-billing.ts / lib/hr/labor-service.ts; these actions only
// add auth, validation and cache revalidation around them.

"use server";

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/actions/shared/guards";
import {
  generateInvoiceFromBillableTime,
  type BillableInvoiceResult,
} from "@/lib/hr/labor-service";

export type LaborActionResult = { ok: boolean; message: string };

// ─── Rate card ────────────────────────────────────────────────────────────────

export type UpsertBillableRateInput = {
  /** Present when editing an existing rate; omitted when adding one. */
  id?: string;
  name: string;
  billRate: number;
  isActive: boolean;
};

/** Add or edit a rate-card service ("what do you bill labour as?"). */
export async function upsertBillableRate(
  input: UpsertBillableRateInput,
): Promise<LaborActionResult> {
  await requireCapability("manage_finance");

  const name = input.name.trim();
  if (!name) return { ok: false, message: "Give the service a name." };
  if (!Number.isFinite(input.billRate) || input.billRate <= 0) {
    return { ok: false, message: "Enter an hourly rate greater than zero." };
  }

  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) return { ok: false, message: "No organization configured yet." };

  if (input.id) {
    const existing = await prisma.billableRate.findFirst({
      where: { id: input.id, organizationId: org.id },
      select: { id: true },
    });
    if (!existing) return { ok: false, message: "Rate not found." };
    await prisma.billableRate.update({
      where: { id: input.id },
      data: { name, billRate: input.billRate, isActive: input.isActive },
    });
  } else {
    await prisma.billableRate.create({
      data: {
        organizationId: org.id,
        name,
        billRate: input.billRate,
        isActive: input.isActive,
      },
    });
  }

  revalidatePath("/finance/settings/rate-card");
  revalidatePath("/finance/settings");
  return { ok: true, message: `Saved ${name}.` };
}

// ─── Billable time → draft invoice ───────────────────────────────────────────

/**
 * Turn a customer's approved, un-invoiced billable hours into a draft invoice.
 * Returns the typed result (draft invoice ref/link, hours billed, skipped
 * entries with reasons) so the UI can surface skips as a fix-it nudge.
 */
export async function generateBillableInvoice(
  customerAccountId: string,
): Promise<BillableInvoiceResult> {
  await requireCapability("manage_finance");

  const result = await generateInvoiceFromBillableTime(customerAccountId);

  if (result.generated) {
    revalidatePath(`/customer/${customerAccountId}`);
    revalidatePath("/finance/invoices");
  }
  return result;
}
