"use server";

import { prisma } from "@dpf/db";
import { nanoid } from "nanoid";
import { generateInvoiceFromStorefrontOrder } from "@/lib/actions/finance";

async function getPublishedStorefront(slug: string) {
  const config = await prisma.storefrontConfig.findFirst({
    where: { organization: { slug }, isPublished: true },
    select: { id: true },
  });
  return config ?? null;
}

function makeRef(prefix: string) {
  return `${prefix}-${nanoid(8).toUpperCase()}`;
}

type ActionResult =
  | { success: true; ref: string; type: string }
  | { success: false; error: string };

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
): Promise<ActionResult> {
  const storefront = await getPublishedStorefront(slug);
  if (!storefront) return { success: false, error: "Storefront not found or not published" };

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

  return { success: true, ref: created.inquiryRef, type: "inquiry" };
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
    holderToken?: string;
    providerId?: string;
    assignmentMode?: string;
    idempotencyKey?: string;
    recurrenceRule?: "weekly" | "biweekly" | "monthly";
    recurrenceEndDate?: Date;
  }
): Promise<ActionResult> {
  const storefront = await getPublishedStorefront(slug);
  if (!storefront) return { success: false, error: "Storefront not found or not published" };

  // Hold validation
  let holdId: string | undefined;
  if (data.holderToken) {
    const hold = await prisma.bookingHold.findFirst({
      where: { holderToken: data.holderToken, expiresAt: { gt: new Date() } },
    });
    if (!hold) return { success: false, error: "Invalid or expired hold" };
    holdId = hold.id;
  }

  const ref = makeRef("BK");
  let created: { id: string; bookingRef: string };
  try {
    created = await prisma.storefrontBooking.create({
      data: {
        bookingRef: ref,
        storefrontId: storefront.id,
        itemId: data.itemId,
        customerEmail: data.customerEmail,
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        scheduledAt: data.scheduledAt,
        durationMinutes: data.durationMinutes,
        notes: data.notes,
        providerId: data.providerId,
        assignmentMode: data.assignmentMode,
        idempotencyKey: data.idempotencyKey,
        recurrenceRule: data.recurrenceRule,
      },
      select: { id: true, bookingRef: true },
    });
  } catch (err) {
    const prismaError = err as Error & { code?: string };
    if (prismaError.code === "P2002") {
      return { success: false, error: "Duplicate submission" };
    }
    throw err;
  }

  // Release hold after successful booking
  if (holdId) {
    await prisma.bookingHold.delete({ where: { id: holdId } });
  }

  // Create child bookings for recurrence
  if (data.recurrenceRule && data.recurrenceEndDate) {
    const futureDates = projectRecurrenceDates(data.scheduledAt, data.recurrenceRule, data.recurrenceEndDate);
    for (const futureDate of futureDates) {
      const futureScheduledAt = new Date(futureDate);
      futureScheduledAt.setHours(data.scheduledAt.getHours(), data.scheduledAt.getMinutes());
      await prisma.storefrontBooking.create({
        data: {
          bookingRef: makeRef("BK"),
          storefrontId: storefront.id,
          itemId: data.itemId,
          customerEmail: data.customerEmail,
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          scheduledAt: futureScheduledAt,
          durationMinutes: data.durationMinutes,
          notes: data.notes,
          providerId: data.providerId,
          assignmentMode: data.assignmentMode,
          recurrenceRule: data.recurrenceRule,
          parentBookingId: created.id,
        },
      });
    }
  }

  return { success: true, ref: created.bookingRef, type: "booking" };
}

// ── Order ─────────────────────────────────────────────────────────────────────

export async function submitOrder(
  slug: string,
  data: {
    customerEmail: string;
    items: Array<{ itemId: string; name: string; qty: number; unitPrice: number }>;
    totalAmount: number | string; // ignored — recalculated server-side
    currency?: string;
  }
): Promise<ActionResult> {
  const storefront = await getPublishedStorefront(slug);
  if (!storefront) return { success: false, error: "Storefront not found or not published" };

  if (!data.items || data.items.length === 0) {
    return { success: false, error: "Order must contain at least one item" };
  }

  // Look up authoritative prices for all submitted item IDs in one query
  const itemIds = data.items.map((i) => i.itemId);
  const dbItems = await prisma.storefrontItem.findMany({
    where: {
      itemId: { in: itemIds },
      storefrontId: storefront.id,
      isActive: true,
    },
    select: { itemId: true, priceAmount: true },
  });

  const priceMap = new Map(dbItems.map((r) => [r.itemId, r.priceAmount]));

  // Validate every line item against database prices
  for (const line of data.items) {
    const dbPrice = priceMap.get(line.itemId);
    if (dbPrice === undefined) {
      return { success: false, error: `Item not found: ${line.itemId}` };
    }
    if (dbPrice === null) {
      return { success: false, error: `Item has no price configured: ${line.itemId}` };
    }
    const actualPrice = dbPrice.toNumber();
    if (Math.abs(actualPrice - line.unitPrice) > 0.001) {
      return { success: false, error: `Price mismatch for item ${line.itemId}` };
    }
  }

  // Compute total server-side — never trust caller-supplied totalAmount
  const computedTotal = data.items.reduce((sum, line) => {
    const actualPrice = priceMap.get(line.itemId)!.toNumber();
    return sum + actualPrice * line.qty;
  }, 0);

  const ref = makeRef("ORD");
  const created = await prisma.storefrontOrder.create({
    data: {
      orderRef: ref,
      storefrontId: storefront.id,
      customerEmail: data.customerEmail,
      items: data.items as never,
      totalAmount: computedTotal,
      currency: data.currency ?? "GBP",
    },
    select: { id: true, orderRef: true },
  });

  // Auto-generate invoice from storefront order
  try {
    await generateInvoiceFromStorefrontOrder(created.id);
  } catch (err) {
    console.error("Auto-invoice generation failed for StorefrontOrder", created.orderRef, err);
  }

  return { success: true, ref: created.orderRef, type: "order" };
}

// ── Donation ──────────────────────────────────────────────────────────────────

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
): Promise<ActionResult> {
  const storefront = await getPublishedStorefront(slug);
  if (!storefront) return { success: false, error: "Storefront not found or not published" };

  const ref = makeRef("DON");
  const created = await prisma.storefrontDonation.create({
    data: {
      donationRef: ref,
      storefrontId: storefront.id,
      donorEmail: data.donorEmail,
      donorName: data.donorName,
      amount: data.amount,
      currency: data.currency ?? "GBP",
      campaignId: data.campaignId,
      message: data.message,
      isAnonymous: data.isAnonymous ?? false,
    },
    select: { donationRef: true },
  });

  return { success: true, ref: created.donationRef, type: "donation" };
}
