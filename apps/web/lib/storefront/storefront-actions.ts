"use server";

import { prisma } from "@dpf/db";
import { newId } from "@/lib/shared/new-id";
import { ok, err as fail, type ActionResult } from "@/lib/shared/action-result";
import { generateInvoiceFromStorefrontOrder } from "@/lib/actions/finance";
import { isExclusionViolation } from "@/lib/db/exclusion-violation";
import {
  createProductSoldDraft,
  createTypedFulfillmentInstance,
  materializeProductSold,
  persistProductFulfillmentInstance,
} from "@/lib/products/product-sold";
import {
  persistProductSoldComponentAllocations,
  snapshotProductSoldComponents,
} from "@/lib/products/product-sold-commercial-persistence";
import { createProductManagementChangeCollector } from "@/lib/product-management/product-management-playbook-refresh";
import {
  allocateHospitalityCapacity,
  releaseHospitalityCapacityByDemand,
  resolveHospitalityResourceForProvider,
} from "@/lib/storefront/hospitality-capacity-repository.server";
import { HospitalityCapacityConflictError } from "@/lib/storefront/hospitality-capacity";

/** Sentinel: the hold token was missing/expired when re-checked inside the
 *  booking transaction. Thrown to abort the transaction and surface a clean
 *  message without leaking a partial write. */
class BookingHoldInvalidError extends Error {}
class RestaurantTableUnavailableError extends Error {}

async function getPublishedStorefront(slug: string) {
  const config = await prisma.storefrontConfig.findFirst({
    where: { organization: { slug }, isPublished: true },
    select: {
      id: true,
      organizationId: true,
      archetype: { select: { archetypeId: true } },
    },
  });
  return config
    ? {
        id: config.id,
        organizationId: config.organizationId,
        storefrontArchetypeId: config.archetype?.archetypeId ?? null,
      }
    : null;
}

function makeRef(prefix: string) {
  return `${prefix}-${newId(8).toUpperCase()}`;
}

/** Public storefront submissions resolve to a reference + record type. */
type SubmissionReceipt = { ref: string; type: string };

// ── Inquiry ──────────────────────────────────────────────────────────────────

export async function submitInquiry(
  slug: string,
  data: {
    customerEmail: string;
    customerName: string;
    customerPhone?: string;
    message?: string;
    itemId?: string;
    formData?: Record<string, unknown>;
  }
): Promise<ActionResult<SubmissionReceipt>> {
  const storefront = await getPublishedStorefront(slug);
  if (!storefront) return fail("Storefront not found or not published");

  const ref = makeRef("INQ");
  const created = await prisma.storefrontInquiry.create({
    data: {
      inquiryRef: ref,
      storefrontId: storefront.id,
      itemId: data.itemId,
      customerEmail: data.customerEmail,
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      message: data.message,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formData: data.formData as any,
    },
    select: { inquiryRef: true },
  });

  return ok({ ref: created.inquiryRef, type: "inquiry" });
}

// ── Booking ───────────────────────────────────────────────────────────────────

function projectRecurrenceDates(
  startDate: Date,
  rule: "weekly" | "biweekly" | "monthly",
  endDate: Date
): Date[] {
  const dates: Date[] = [];
  const msPerDay = 86400000;
  const interval = rule === "weekly" ? 7 : rule === "biweekly" ? 14 : 0;
  const cursor = new Date(startDate.getTime());

  if (rule === "monthly") {
    const dayOfMonth = cursor.getDate();
    let month = cursor.getMonth() + 1;
    let year = cursor.getFullYear();
    while (true) {
      if (month > 11) { month = 0; year++; }
      const lastDay = new Date(year, month + 1, 0).getDate();
      const d = new Date(year, month, Math.min(dayOfMonth, lastDay));
      if (d > endDate) break;
      dates.push(d);
      month++;
    }
  } else {
    // Compare dates at UTC day granularity so a recurrence falling on the end
    // date is included regardless of the time component in the end date.
    const endDateUTCDay = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate());
    let next = new Date(cursor.getTime() + interval * msPerDay);
    while (true) {
      const nextUTCDay = Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate());
      if (nextUTCDay > endDateUTCDay) break;
      dates.push(new Date(next));
      next = new Date(next.getTime() + interval * msPerDay);
    }
  }
  return dates;
}

export async function submitBooking(
  slug: string,
  data: {
    itemId: string;
    customerEmail: string;
    customerName: string;
    customerPhone?: string;
    scheduledAt: Date;
    durationMinutes: number;
    notes?: string;
    covers?: number;
    dietaryNotes?: string;
    holderToken?: string;
    providerId?: string;
    assignmentMode?: string;
    idempotencyKey?: string;
    recurrenceRule?: "weekly" | "biweekly" | "monthly";
    recurrenceEndDate?: Date;
  }
): Promise<ActionResult<SubmissionReceipt>> {
  const storefront = await getPublishedStorefront(slug);
  if (!storefront) return fail("Storefront not found or not published");
  const commercialItem = await prisma.storefrontItem.findFirst({
    where: {
      storefrontId: storefront.id,
      isActive: true,
      OR: [{ itemId: data.itemId }, { id: data.itemId }],
    },
    select: {
      id: true,
      itemId: true,
      name: true,
      priceAmount: true,
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
    },
  });

  // Hold validation, booking creation, hold release, and recurrence expansion
  // run in ONE transaction so the validate→book→release sequence is atomic and
  // the `StorefrontBooking_no_overlap` gist EXCLUDE constraint is the single
  // authoritative arbiter of slot contention (EP-056D2A5E, kernel D2). Two
  // concurrent requests that pass the hold check both attempt the insert; the
  // DB rejects the loser with SQLSTATE 23P01 rather than double-booking.
  const ref = makeRef("BK");
  let created: { id: string; bookingRef: string };
  const productManagementChanges = createProductManagementChangeCollector();
  try {
    created = await prisma.$transaction(async (tx) => {
      const materializeBooking = async (
        booking: { id: string; bookingRef: string },
        scheduledAt: Date,
      ) => {
        if (!commercialItem?.catalogItem || !commercialItem.priceAmount) return;
        const unitPrice = commercialItem.priceAmount.toNumber();
        const catalogItem = commercialItem.catalogItem;
        const observedAt = new Date();
        const pricingSnapshot = {
          version: 1,
          source: "storefront-item-price",
          storefrontItemId: commercialItem.itemId,
          unitPrice,
          quantity: 1,
          totalAmount: unitPrice,
          currency: commercialItem.priceCurrency,
        };
        const draft = createProductSoldDraft({
          selection: {
            organizationId: storefront.organizationId,
            providerOrganizationId:
              catalogItem.offering.providerOrganizationId,
            product: catalogItem.offering.product,
            offering: catalogItem.offering,
            catalogItem,
            catalogSku: null,
            configuration: null,
            priceListEntryId: null,
            promotionId: null,
            quantity: 1,
            unitPrice,
            discountAmount: 0,
            taxAmount: 0,
            totalAmount: unitPrice,
            currency: commercialItem.priceCurrency,
            purchasedAt: observedAt,
            configurationSnapshot: null,
            pricingSnapshot,
          },
          evidence: {
            kind: "storefront-booking",
            sourceId: booking.id,
            sourceRef: booking.bookingRef,
            observedAt,
            snapshot: {
              bookingRef: booking.bookingRef,
              scheduledAt: scheduledAt.toISOString(),
              durationMinutes: data.durationMinutes,
              customerEmail: data.customerEmail,
              customerName: data.customerName,
              customerPhone: data.customerPhone ?? null,
              covers: data.covers ?? null,
              dietaryNotes: data.dietaryNotes ?? null,
            },
          },
        });
        const materialized = await materializeProductSold({
          db: tx as never,
          draft,
          collectChange: productManagementChanges.collect,
        });
        await persistProductSoldComponentAllocations({
          db: tx as never,
          organizationId: storefront.organizationId,
          productSoldId: materialized.id,
          packageRevenue: unitPrice,
          components: snapshotProductSoldComponents(
            catalogItem.bundleComponents ?? [],
          ),
        });
        const instance = createTypedFulfillmentInstance({
          evidenceId: materialized.evidenceId,
          kind: "booking",
          status: "active",
          targets: {
            storefrontBookingId: booking.id,
            rentalAgreementId: null,
            rentableUnitId: null,
            edgeNodeId: null,
          },
          snapshot: {
            bookingRef: booking.bookingRef,
            scheduledAt: scheduledAt.toISOString(),
            durationMinutes: data.durationMinutes,
          },
        });
        await persistProductFulfillmentInstance({
          db: tx as never,
          organizationId: storefront.organizationId,
          productSoldId: materialized.id,
          instance,
        });
      };

      let holdId: string | undefined;
      let holdToken: string | undefined;
      let hospitalityResourceId: string | null = null;
      if (data.holderToken) {
        const hold = await tx.bookingHold.findFirst({
          where: {
            holderToken: data.holderToken,
            storefrontId: storefront.id,
            itemId: commercialItem?.id ?? data.itemId,
            expiresAt: { gt: new Date() },
          },
        });
        if (!hold) throw new BookingHoldInvalidError();
        holdId = hold.id;
        holdToken = hold.holderToken;
        hospitalityResourceId = hold.hospitalityResourceId ?? null;
      }

      if (!hospitalityResourceId && data.providerId) {
        const resource = await resolveHospitalityResourceForProvider(
          tx as never,
          {
            organizationId: storefront.organizationId,
            storefrontId: storefront.id,
            providerId: data.providerId,
            bookingAccess: "online",
          },
        );
        hospitalityResourceId = resource?.id ?? null;
      }

      if (
        storefront.storefrontArchetypeId === "restaurant" &&
        !hospitalityResourceId
      ) {
        throw new RestaurantTableUnavailableError();
      }

      if (holdToken && hospitalityResourceId) {
        await releaseHospitalityCapacityByDemand(tx as never, {
          organizationId: storefront.organizationId,
          demandType: "hold",
          demandRef: holdToken,
          at: new Date(),
          reason: "converted to booking",
          clearBookingHoldLink: true,
        });
      }

      const booking = await tx.storefrontBooking.create({
        data: {
          bookingRef: ref,
          organizationId: storefront.organizationId,
          storefrontId: storefront.id,
          itemId: data.itemId,
          customerEmail: data.customerEmail,
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          scheduledAt: data.scheduledAt,
          durationMinutes: data.durationMinutes,
          notes: data.notes,
          covers: data.covers,
          dietaryNotes: data.dietaryNotes,
          providerId: data.providerId,
          hospitalityResourceId,
          assignmentMode: data.assignmentMode,
          idempotencyKey: data.idempotencyKey,
          recurrenceRule: data.recurrenceRule,
        },
        select: { id: true, bookingRef: true },
      });
      if (hospitalityResourceId) {
        await allocateHospitalityCapacity(tx as never, {
          organizationId: storefront.organizationId,
          storefrontId: storefront.id,
          resourceId: hospitalityResourceId,
          poolId: null,
          demandType: "booking",
          demandRef: booking.bookingRef,
          bookingId: booking.id,
          bookingHoldId: null,
          startsAt: data.scheduledAt,
          endsAt: new Date(
            data.scheduledAt.getTime() + data.durationMinutes * 60_000,
          ),
          quantity: data.covers ?? 1,
          idempotencyKey: `booking:${booking.id}`,
        });
      }
      await materializeBooking(booking, data.scheduledAt);

      // Release hold only after the booking commits within this transaction.
      if (holdId) {
        await tx.bookingHold.delete({ where: { id: holdId } });
      }

      // Create child bookings for recurrence in the same transaction so a
      // failed child rolls the whole tree back instead of leaving a partial series.
      if (data.recurrenceRule && data.recurrenceEndDate) {
        const futureDates = projectRecurrenceDates(data.scheduledAt, data.recurrenceRule, data.recurrenceEndDate);
        for (const futureDate of futureDates) {
          const futureScheduledAt = new Date(futureDate);
          futureScheduledAt.setHours(data.scheduledAt.getHours(), data.scheduledAt.getMinutes());
          const childBooking = await tx.storefrontBooking.create({
            data: {
              bookingRef: makeRef("BK"),
              organizationId: storefront.organizationId,
              storefrontId: storefront.id,
              itemId: data.itemId,
              customerEmail: data.customerEmail,
              customerName: data.customerName,
              customerPhone: data.customerPhone,
              scheduledAt: futureScheduledAt,
              durationMinutes: data.durationMinutes,
              notes: data.notes,
              covers: data.covers,
              dietaryNotes: data.dietaryNotes,
              providerId: data.providerId,
              hospitalityResourceId,
              assignmentMode: data.assignmentMode,
              recurrenceRule: data.recurrenceRule,
              parentBookingId: booking.id,
            },
            select: { id: true, bookingRef: true },
          });
          if (hospitalityResourceId) {
            await allocateHospitalityCapacity(tx as never, {
              organizationId: storefront.organizationId,
              storefrontId: storefront.id,
              resourceId: hospitalityResourceId,
              poolId: null,
              demandType: "booking",
              demandRef: childBooking.bookingRef,
              bookingId: childBooking.id,
              bookingHoldId: null,
              startsAt: futureScheduledAt,
              endsAt: new Date(
                futureScheduledAt.getTime() + data.durationMinutes * 60_000,
              ),
              quantity: data.covers ?? 1,
              idempotencyKey: `booking:${childBooking.id}`,
            });
          }
          await materializeBooking(childBooking, futureScheduledAt);
        }
      }

      return booking;
    });
  } catch (err) {
    if (err instanceof BookingHoldInvalidError) {
      return fail("Invalid or expired hold");
    }
    if (err instanceof RestaurantTableUnavailableError) {
      return fail("That table is not available for reservations. Please choose another time.");
    }
    if (err instanceof HospitalityCapacityConflictError) {
      return fail("That table cannot seat this party. Please choose a smaller party or contact the venue.");
    }
    if (isExclusionViolation(err)) {
      return fail("That time slot is no longer available");
    }
    const prismaError = err as Error & { code?: string };
    if (prismaError.code === "P2002") {
      return fail("Duplicate submission");
    }
    throw err;
  }
  await productManagementChanges.flush();

  return ok({ ref: created.bookingRef, type: "booking" });
}

// ── Order ─────────────────────────────────────────────────────────────────────

export async function submitOrder(
  slug: string,
  data: {
    customerEmail: string;
    customerName?: string;
    deliveryAddress?: {
      line1: string;
      line2?: string;
      city: string;
      county?: string;
      postcode: string;
      country: string;
    };
    items: Array<{ itemId: string; name: string; qty: number; unitPrice: number }>;
    totalAmount: number | string; // ignored — recalculated server-side
    currency?: string;
  }
): Promise<ActionResult<SubmissionReceipt>> {
  const storefront = await getPublishedStorefront(slug);
  if (!storefront) return fail("Storefront not found or not published");

  if (!data.items || data.items.length === 0) {
    return fail("Order must contain at least one item");
  }

  // Look up authoritative prices for all submitted item IDs in one query
  const itemIds = data.items.map((i) => i.itemId);
  const dbItems = await prisma.storefrontItem.findMany({
    where: {
      itemId: { in: itemIds },
      storefrontId: storefront.id,
      isActive: true,
    },
    select: {
      itemId: true,
      name: true,
      priceAmount: true,
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
    },
  });

  const priceMap = new Map(dbItems.map((r) => [r.itemId, r.priceAmount]));
  const itemMap = new Map(dbItems.map((item) => [item.itemId, item]));

  // Validate every line item against database prices
  for (const line of data.items) {
    const dbPrice = priceMap.get(line.itemId);
    if (dbPrice === undefined) {
      return fail(`Item not found: ${line.itemId}`);
    }
    if (dbPrice === null) {
      return fail(`Item has no price configured: ${line.itemId}`);
    }
    const actualPrice = dbPrice.toNumber();
    if (Math.abs(actualPrice - line.unitPrice) > 0.001) {
      return fail(`Price mismatch for item ${line.itemId}`);
    }
  }

  // Compute total server-side — never trust caller-supplied totalAmount
  const computedTotal = data.items.reduce((sum, line) => {
    const actualPrice = priceMap.get(line.itemId)!.toNumber();
    return sum + actualPrice * line.qty;
  }, 0);

  const ref = makeRef("ORD");
  const currency = data.currency ?? "GBP";
  const purchasedAt = new Date();
  const productManagementChanges = createProductManagementChangeCollector();
  const created = await prisma.$transaction(async (tx) => {
    const order = await tx.storefrontOrder.create({
      data: {
        orderRef: ref,
        organizationId: storefront.organizationId,
        storefrontId: storefront.id,
        customerEmail: data.customerEmail,
        customerName: data.customerName ?? null,
        deliveryAddress: data.deliveryAddress
          ? (data.deliveryAddress as never)
          : undefined,
        items: data.items as never,
        totalAmount: computedTotal,
        currency,
      },
      select: { id: true, orderRef: true },
    });

    for (const [sourcePosition, submittedLine] of data.items.entries()) {
      const item = itemMap.get(submittedLine.itemId);
      const catalogItem = item?.catalogItem;
      if (!item || !catalogItem) {
        // Legacy unlinked items remain purchasable through the JSON payload.
        // No normalized line or ProductSold is guessed without a canonical
        // CatalogItem and complete Product/Offering chain.
        continue;
      }
      const unitPrice = item.priceAmount!.toNumber();
      const totalAmount = unitPrice * submittedLine.qty;
      const pricingSnapshot = {
        version: 1,
        source: "storefront-item-price",
        storefrontItemId: submittedLine.itemId,
        unitPrice,
        quantity: submittedLine.qty,
        totalAmount,
        currency,
      };
      const orderLine = await tx.storefrontOrderLineItem.create({
        data: {
          lineId: `ORDERLINE-${newId(8).toUpperCase()}`,
          organizationId: storefront.organizationId,
          storefrontOrderId: order.id,
          catalogItemId: catalogItem.id,
          description: item.name,
          quantity: submittedLine.qty,
          unitPrice,
          discountAmount: 0,
          taxAmount: 0,
          totalAmount,
          currency,
          pricingSnapshot,
          sourcePosition,
          sourceKind: "storefront-order-json",
          sourceRef: `${order.orderRef}:${sourcePosition + 1}`,
        },
        select: { id: true },
      });

      const draft = createProductSoldDraft({
        selection: {
          organizationId: storefront.organizationId,
          providerOrganizationId:
            catalogItem.offering.providerOrganizationId,
          product: catalogItem.offering.product,
          offering: catalogItem.offering,
          catalogItem,
          catalogSku: null,
          configuration: null,
          priceListEntryId: null,
          promotionId: null,
          quantity: submittedLine.qty,
          unitPrice,
          discountAmount: 0,
          taxAmount: 0,
          totalAmount,
          currency,
          purchasedAt,
          configurationSnapshot: null,
          pricingSnapshot,
        },
        evidence: {
          kind: "storefront-order-line",
          sourceId: orderLine.id,
          sourceRef: `${order.orderRef}:${sourcePosition + 1}`,
          observedAt: purchasedAt,
          snapshot: {
            orderRef: order.orderRef,
            customerEmail: data.customerEmail,
            customerName: data.customerName ?? null,
            deliveryAddress: data.deliveryAddress ?? null,
          },
        },
      });
      const materialized = await materializeProductSold({
        db: tx as never,
        draft,
        collectChange: productManagementChanges.collect,
      });
      await persistProductSoldComponentAllocations({
        db: tx as never,
        organizationId: storefront.organizationId,
        productSoldId: materialized.id,
        packageRevenue: totalAmount,
        components: snapshotProductSoldComponents(
          catalogItem.bundleComponents ?? [],
        ),
      });
    }

    return order;
  });
  await productManagementChanges.flush();

  // Auto-generate invoice from storefront order
  try {
    await generateInvoiceFromStorefrontOrder(created.id);
  } catch (err) {
    console.error("Auto-invoice generation failed for StorefrontOrder", created.orderRef, err);
  }

  return ok({ ref: created.orderRef, type: "order" });
}

// ── Donation ──────────────────────────────────────────────────────────────────

/** The workspace's own base currency — the one source `/s/[slug]/donate` also
 *  renders its symbol from. Falls back to USD, matching `resolveInquiryFormSchema`. */
async function resolveOrgBaseCurrency(): Promise<string> {
  const settings = await prisma.orgSettings.findFirst({ select: { baseCurrency: true } });
  return settings?.baseCurrency ?? "USD";
}

export async function submitDonation(
  slug: string,
  data: {
    donorEmail: string;
    donorName?: string;
    amount: number | string;
    currency?: string;
    campaignId?: string;
    message?: string;
    isAnonymous?: boolean;
  }
): Promise<ActionResult<SubmissionReceipt>> {
  const storefront = await getPublishedStorefront(slug);
  if (!storefront) return fail("Storefront not found or not published");

  const ref = makeRef("DON");
  const created = await prisma.storefrontDonation.create({
    data: {
      donationRef: ref,
      storefrontId: storefront.id,
      donorEmail: data.donorEmail,
      donorName: data.donorName,
      amount: data.amount,
      // The workspace's own currency, never a hardcoded one. This read
      // `data.currency ?? "GBP"`, and `DonationForm` passes no currency, so on
      // every non-GBP install the donate page showed the org's symbol while the
      // row was written GBP (BI-685ADDCD). A USD rescue took $50 and $25 and its
      // books said GBP. Resolved on the server so the stored code cannot drift
      // from the symbol the donor saw — the donate page derives that symbol from
      // this same `OrgSettings.baseCurrency`. An explicit currency still wins, so
      // a later multi-currency flow is not foreclosed.
      currency: data.currency ?? (await resolveOrgBaseCurrency()),
      campaignId: data.campaignId,
      message: data.message,
      isAnonymous: data.isAnonymous ?? false,
    },
    select: { donationRef: true },
  });

  return ok({ ref: created.donationRef, type: "donation" });
}
