"use server";

import * as crypto from "crypto";
import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  RENTAL_CONDITION_PHASES,
  hasUnitConflict,
  type AgreementPeriod,
} from "@/lib/storefront/rental";
import { isExclusionViolation } from "@/lib/db/exclusion-violation";
import {
  createProductSoldDraft,
  createTypedFulfillmentInstance,
  materializeProductSold,
  persistProductFulfillmentInstance,
  persistProductSoldComponentAllocations,
  snapshotProductSoldComponents,
  transitionProductSoldByEvidence,
} from "@/lib/products/product-sold";

/** Sentinel: the pre-check found an overlapping agreement for this unit.
 *  Thrown to abort the reservation transaction with a friendly message before
 *  the DB-level `RentalAgreement_no_overlap` constraint would reject it anyway. */
class UnitConflictError extends Error {}

// EP-ARCH-8D4F2A · BI-EEA24A34/BI-D7FCD029 Phase 4 — rental reservation→return
// lifecycle. Conventions mirror lib/actions/civic-governance.ts: auth via the
// storefront capability, single-org resolution, { ok, message } result shape,
// revalidatePath refresh. The durable conflict guard reuses the Phase 3 pure
// capacity helpers (BookingHold covers the optimistic-concurrency window; this
// is the confirm-time check).

export type RentalActionResult = { ok: boolean; message: string; id?: string };

async function requireManageRental() {
  const session = await auth();
  if (
    !session?.user ||
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "view_storefront",
    )
  ) {
    throw new Error("Unauthorized");
  }
  return session.user;
}

function makeRef(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

async function getStorefront(): Promise<{ id: string; organizationId: string }> {
  const sf = await prisma.storefrontConfig.findFirst({
    select: { id: true, organizationId: true },
  });
  if (!sf) throw new Error("No storefront configured");
  return sf;
}

function calculateRentalCharge(input: {
  pricingModel: string;
  rateAmount: number | undefined;
  periodStart: Date;
  periodEnd: Date;
}): number | null {
  if (input.rateAmount == null || input.rateAmount < 0) return null;
  const durationMs = input.periodEnd.getTime() - input.periodStart.getTime();
  switch (input.pricingModel) {
    case "fixed":
      return input.rateAmount;
    case "per-day":
      return Math.ceil(durationMs / 86_400_000) * input.rateAmount;
    case "per-week":
      return Math.ceil(durationMs / (7 * 86_400_000)) * input.rateAmount;
    default:
      return null;
  }
}

// ─── Fleet setup ──────────────────────────────────────────────────────────────

export async function addRentableUnit(input: {
  storefrontItemId: string;
  label: string;
  unitRef?: string;
  meterReading?: number;
}): Promise<RentalActionResult> {
  await requireManageRental();
  try {
    if (!input.label.trim()) return { ok: false, message: "A unit label is required" };
    const sf = await getStorefront();
    const item = await prisma.storefrontItem.findFirst({
      where: { id: input.storefrontItemId, storefrontId: sf.id },
      select: { id: true },
    });
    if (!item) return { ok: false, message: "Rental class not found" };
    const unit = await prisma.rentableUnit.create({
      data: {
        unitId: makeRef("RU"),
        storefrontId: sf.id,
        storefrontItemId: item.id,
        label: input.label.trim(),
        unitRef: input.unitRef?.trim() || null,
        meterReading: input.meterReading ?? null,
        status: "available",
      },
    });
    revalidatePath("/rental");
    return { ok: true, message: `Unit ${unit.unitId} added`, id: unit.id };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to add unit" };
  }
}

// ─── Reservation ────────────────────────────────────────────────────────────

export async function createReservation(input: {
  storefrontItemId: string;
  rentableUnitId?: string;
  customerEmail: string;
  customerName: string;
  customerPhone?: string;
  periodStart: string;
  periodEnd: string;
  pricingModel?: string;
  rateAmount?: number;
  depositAmount?: number;
}): Promise<RentalActionResult> {
  await requireManageRental();
  try {
    const periodStart = new Date(input.periodStart);
    const periodEnd = new Date(input.periodEnd);
    if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
      return { ok: false, message: "Valid start and end dates are required" };
    }
    if (periodEnd <= periodStart) {
      return { ok: false, message: "Return date must be after pickup date" };
    }
    if (!input.customerName.trim() || !input.customerEmail.trim()) {
      return { ok: false, message: "Renter name and email are required" };
    }
    const sf = await getStorefront();
    const item = await prisma.storefrontItem.findFirst({
      where: { id: input.storefrontItemId, storefrontId: sf.id },
      select: {
        id: true,
        name: true,
        priceCurrency: true,
        catalogItem: {
          select: {
            id: true,
            catalogItemId: true,
            name: true,
            organizationId: true,
            bundleComponents: {
              where: { effectiveTo: null },
              orderBy: { sortOrder: "asc" },
              include: { componentCatalogItem: true },
            },
            offering: {
              select: {
                id: true,
                offeringId: true,
                name: true,
                organizationId: true,
                providerOrganizationId: true,
                product: {
                  select: {
                    id: true,
                    productId: true,
                    name: true,
                    organizationId: true,
                  },
                },
              },
            },
          },
        },
        rentableUnits: {
          where: { id: input.rentableUnitId ?? "__quantity_pool__" },
          take: 1,
          select: {
            id: true,
            catalogSku: {
              select: {
                id: true,
                skuId: true,
                code: true,
                name: true,
                configuration: {
                  select: {
                    id: true,
                    configurationId: true,
                    name: true,
                    specification: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!item) return { ok: false, message: "Rental class not found" };
    const pricingModel = input.pricingModel || "per-day";
    const totalAmount = calculateRentalCharge({
      pricingModel,
      rateAmount: input.rateAmount,
      periodStart,
      periodEnd,
    });

    // The application-level overlap check is a fast, friendly pre-check; the
    // authoritative guard is the `RentalAgreement_no_overlap` gist EXCLUDE
    // constraint (EP-056D2A5E, kernel D2). Both the check and the create run in
    // ONE transaction so a concurrent reservation that slips past the check is
    // still rejected by the DB (SQLSTATE 23P01) instead of double-booking the unit.
    const agreement = await prisma.$transaction(async (tx) => {
      if (input.rentableUnitId) {
        const existing = await tx.rentalAgreement.findMany({
          where: { storefrontId: sf.id, rentableUnitId: input.rentableUnitId },
          select: { status: true, periodStart: true, periodEnd: true, rentableUnitId: true },
        });
        const conflict = hasUnitConflict({
          rentableUnitId: input.rentableUnitId,
          agreements: existing as AgreementPeriod[],
          windowStart: periodStart,
          windowEnd: periodEnd,
        });
        if (conflict) {
          throw new UnitConflictError();
        }
      }

      const ag = await tx.rentalAgreement.create({
        data: {
          agreementRef: makeRef("RA"),
          storefrontId: sf.id,
          storefrontItemId: input.storefrontItemId,
          rentableUnitId: input.rentableUnitId || null,
          customerEmail: input.customerEmail.trim(),
          customerName: input.customerName.trim(),
          customerPhone: input.customerPhone?.trim() || null,
          periodStart,
          periodEnd,
          pricingModel,
          rateAmount: input.rateAmount ?? null,
          depositAmount: input.depositAmount ?? null,
          currency: item.priceCurrency,
          status: "reserved",
          verificationStatus: input.depositAmount && input.depositAmount > 0 ? "pending" : "not-required",
        },
      });
      const catalogItem = item.catalogItem;
      if (catalogItem && totalAmount != null) {
        const catalogSku = item.rentableUnits[0]?.catalogSku ?? null;
        const configuration = catalogSku?.configuration ?? null;
        const observedAt = new Date();
        const pricingSnapshot = {
          version: 1,
          source: "rental-agreement-rate",
          pricingModel,
          rateAmount: input.rateAmount ?? null,
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
          totalAmount,
          currency: item.priceCurrency,
          depositAmount: input.depositAmount ?? null,
        };
        const draft = createProductSoldDraft({
          selection: {
            organizationId: sf.organizationId,
            providerOrganizationId:
              catalogItem.offering.providerOrganizationId,
            product: catalogItem.offering.product,
            offering: catalogItem.offering,
            catalogItem,
            catalogSku,
            configuration,
            priceListEntryId: null,
            promotionId: null,
            quantity: 1,
            unitPrice: totalAmount,
            discountAmount: 0,
            taxAmount: 0,
            totalAmount,
            currency: item.priceCurrency,
            purchasedAt: observedAt,
            configurationSnapshot: configuration?.specification ?? null,
            pricingSnapshot,
          },
          evidence: {
            kind: "rental-agreement",
            sourceId: ag.id,
            sourceRef: ag.agreementRef,
            observedAt,
            snapshot: {
              agreementRef: ag.agreementRef,
              status: ag.status,
              customerEmail: input.customerEmail.trim(),
              customerName: input.customerName.trim(),
              periodStart: periodStart.toISOString(),
              periodEnd: periodEnd.toISOString(),
            },
          },
        });
        const materialized = await materializeProductSold({
          db: tx as never,
          draft,
        });
        await persistProductSoldComponentAllocations({
          db: tx as never,
          organizationId: sf.organizationId,
          productSoldId: materialized.id,
          packageRevenue: totalAmount,
          components: snapshotProductSoldComponents(
            catalogItem.bundleComponents ?? [],
          ),
        });
        const instance = createTypedFulfillmentInstance({
          evidenceId: materialized.evidenceId,
          kind: "rental",
          status: "active",
          targets: {
            storefrontBookingId: null,
            rentalAgreementId: ag.id,
            rentableUnitId: input.rentableUnitId ?? null,
            edgeNodeId: null,
          },
          snapshot: {
            agreementRef: ag.agreementRef,
            rentableUnitId: input.rentableUnitId ?? null,
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
          },
        });
        await persistProductFulfillmentInstance({
          db: tx as never,
          organizationId: sf.organizationId,
          productSoldId: materialized.id,
          instance,
        });
      }
      if (input.rentableUnitId) {
        await tx.rentableUnit.update({
          where: { id: input.rentableUnitId },
          data: { status: "reserved" },
        });
      }
      return ag;
    });
    revalidatePath("/rental");
    return { ok: true, message: `Reservation ${agreement.agreementRef} created`, id: agreement.id };
  } catch (err) {
    if (err instanceof UnitConflictError || isExclusionViolation(err)) {
      return { ok: false, message: "That unit is already booked for the selected dates" };
    }
    return { ok: false, message: err instanceof Error ? err.message : "Failed to create reservation" };
  }
}

export async function verifyAgreement(id: string): Promise<RentalActionResult> {
  await requireManageRental();
  try {
    await prisma.rentalAgreement.update({
      where: { id },
      data: { status: "verified", verificationStatus: "verified" },
    });
    revalidatePath("/rental");
    return { ok: true, message: "Renter verified" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to verify" };
  }
}

// ─── Checkout (hand the asset over) ───────────────────────────────────────────

export async function checkoutAgreement(
  id: string,
  condition: { meterReading?: number; notes?: string },
): Promise<RentalActionResult> {
  await requireManageRental();
  try {
    const agreement = await prisma.rentalAgreement.findUnique({
      where: { id },
      select: { id: true, rentableUnitId: true, verificationStatus: true },
    });
    if (!agreement) return { ok: false, message: "Agreement not found" };
    if (agreement.verificationStatus === "pending") {
      return { ok: false, message: "Verify the renter before checkout (deposit pending)" };
    }
    const conditionRecordId = await prisma.$transaction(async (tx) => {
      const record = await tx.rentalConditionRecord.create({
        data: {
          agreementId: id,
          phase: "checkout" satisfies (typeof RENTAL_CONDITION_PHASES)[number],
          meterReading: condition.meterReading ?? null,
          notes: condition.notes?.trim() || null,
        },
      });
      await tx.rentalAgreement.update({
        where: { id },
        data: { status: "active", checkoutConditionId: record.id },
      });
      await transitionProductSoldByEvidence({
        db: tx as never,
        kind: "rental-agreement",
        sourceId: id,
        to: "active",
        occurredAt: new Date(),
      });
      if (agreement.rentableUnitId) {
        await tx.rentableUnit.update({
          where: { id: agreement.rentableUnitId },
          data: {
            status: "out",
            meterReading: condition.meterReading ?? undefined,
          },
        });
      }
      return record.id;
    });
    revalidatePath("/rental");
    // The record id lets the desk attach checkout inspection photos
    // (ownerType=RentalConditionRecord, role=inspection-checkout).
    return { ok: true, message: "Checked out — asset is now out", id: conditionRecordId };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to check out" };
  }
}

// ─── Return & inspect → re-pool ───────────────────────────────────────────────

export async function returnAgreement(
  id: string,
  condition: { meterReading?: number; notes?: string; needsMaintenance?: boolean },
): Promise<RentalActionResult> {
  await requireManageRental();
  try {
    const agreement = await prisma.rentalAgreement.findUnique({
      where: { id },
      select: { id: true, rentableUnitId: true, depositAmount: true },
    });
    if (!agreement) return { ok: false, message: "Agreement not found" };
    const conditionRecordId = await prisma.$transaction(async (tx) => {
      const record = await tx.rentalConditionRecord.create({
        data: {
          agreementId: id,
          phase: "return" satisfies (typeof RENTAL_CONDITION_PHASES)[number],
          meterReading: condition.meterReading ?? null,
          notes: condition.notes?.trim() || null,
        },
      });
      await tx.rentalAgreement.update({
        where: { id },
        data: { status: "closed", returnConditionId: record.id },
      });
      await transitionProductSoldByEvidence({
        db: tx as never,
        kind: "rental-agreement",
        sourceId: id,
        to: "fulfilled",
        occurredAt: new Date(),
      });
      if (agreement.rentableUnitId) {
        // Re-pool: damaged units divert to maintenance, otherwise back to available.
        await tx.rentableUnit.update({
          where: { id: agreement.rentableUnitId },
          data: {
            status: condition.needsMaintenance ? "maintenance" : "available",
            meterReading: condition.meterReading ?? undefined,
          },
        });
      }
      return record.id;
    });
    revalidatePath("/rental");
    const depositNote =
      agreement.depositAmount && Number(agreement.depositAmount) > 0
        ? condition.needsMaintenance
          ? " Deposit held pending damage assessment."
          : " Deposit cleared for release."
        : "";
    return { ok: true, message: `Returned and re-pooled.${depositNote}`, id: conditionRecordId };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to record return" };
  }
}

export async function cancelAgreement(
  id: string,
  reason?: string,
): Promise<RentalActionResult> {
  await requireManageRental();
  try {
    const agreement = await prisma.rentalAgreement.findUnique({
      where: { id },
      select: { rentableUnitId: true, status: true },
    });
    if (!agreement) return { ok: false, message: "Agreement not found" };
    if (agreement.status === "active") {
      return { ok: false, message: "Cannot cancel an active rental — record a return instead" };
    }
    await prisma.$transaction(async (tx) => {
      const cancelledAt = new Date();
      await tx.rentalAgreement.update({
        where: { id },
        data: { status: "cancelled", cancellationReason: reason?.trim() || null, cancelledAt },
      });
      await transitionProductSoldByEvidence({
        db: tx as never,
        kind: "rental-agreement",
        sourceId: id,
        to: "cancelled",
        occurredAt: cancelledAt,
      });
      if (agreement.rentableUnitId) {
        await tx.rentableUnit.update({
          where: { id: agreement.rentableUnitId },
          data: { status: "available" },
        });
      }
    });
    revalidatePath("/rental");
    return { ok: true, message: "Reservation cancelled" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to cancel" };
  }
}
