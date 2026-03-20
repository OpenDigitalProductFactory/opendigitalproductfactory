"use server";

import { prisma } from "@dpf/db";
import { nanoid } from "nanoid";

async function getPublishedStorefront(slug: string) {
  const config = await prisma.storefrontConfig.findFirst({
    where: { organization: { slug }, isPublished: true },
    select: { id: true, isPublished: true },
  });
  if (!config || !config.isPublished) return null;
  return config;
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
      formData: data.formData,
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
    totalAmount: number;
    currency?: string;
  }
): Promise<ActionResult> {
  const storefront = await getPublishedStorefront(slug);
  if (!storefront) return { success: false, error: "Storefront not found or not published" };

  const ref = makeRef("ORD");
  const created = await prisma.storefrontOrder.create({
    data: {
      orderRef: ref,
      storefrontId: storefront.id,
      customerEmail: data.customerEmail,
      items: data.items,
      totalAmount: data.totalAmount,
      currency: data.currency ?? "GBP",
    },
    select: { orderRef: true },
  });

  return { success: true, ref: created.orderRef, type: "order" };
}

// ── Donation ──────────────────────────────────────────────────────────────────

export async function submitDonation(
  slug: string,
  data: {
    donorEmail: string;
    donorName?: string;
    amount: number;
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
