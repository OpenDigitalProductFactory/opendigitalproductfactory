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
  }
): Promise<ActionResult> {
  const storefront = await getPublishedStorefront(slug);
  if (!storefront) return { success: false, error: "Storefront not found or not published" };

  const ref = makeRef("BK");
  const created = await prisma.storefrontBooking.create({
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
    },
    select: { bookingRef: true },
  });

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
