import { prisma } from "@dpf/db";
import { redirect } from "next/navigation";
import { StorefrontInbox } from "@/components/storefront-admin/StorefrontInbox";
import { getOrgSettings } from "@/lib/actions/currency";
import { getCurrencySymbol } from "@/lib/finance/currency-symbol";
import {
  formatInboxCreatedDate,
  formatReservationWhen,
  nextActionForReservation,
} from "@/lib/storefront/booking-summary";
import { nextActionForOrder, summarizeOrderItems } from "@/lib/storefront/order-lifecycle";
import { loadStorefrontOperatingTimezone } from "@/lib/storefront/storefront-operating-timezone.server";

export default async function InboxPage() {
  const config = await prisma.storefrontConfig.findFirst({ select: { id: true } });
  if (!config) redirect("/storefront/setup");

  const operatingTimezone = await loadStorefrontOperatingTimezone(prisma);

  const [inquiries, bookings, orders, donations, providerList, digitalProducts, orgSettings] = await Promise.all([
    prisma.storefrontInquiry.findMany({
      where: { storefrontId: config.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        inquiryRef: true,
        customerName: true,
        customerEmail: true,
        message: true,
        createdAt: true,
      },
    }),
    prisma.storefrontBooking.findMany({
      where: { storefrontId: config.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        bookingRef: true,
        itemId: true,
        customerName: true,
        customerEmail: true,
        scheduledAt: true,
        covers: true,
        dietaryNotes: true,
        status: true,
        createdAt: true,
        provider: { select: { name: true } },
      },
    }),
    prisma.storefrontOrder.findMany({
      where: { storefrontId: config.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        orderRef: true,
        customerName: true,
        customerEmail: true,
        totalAmount: true,
        items: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.storefrontDonation.findMany({
      where: { storefrontId: config.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        donationRef: true,
        donorName: true,
        donorEmail: true,
        amount: true,
        createdAt: true,
      },
    }),
    prisma.serviceProvider.findMany({
      where: { storefrontId: config.id, isActive: true },
      select: { id: true, name: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.digitalProduct.findMany({
      select: {
        id: true,
        name: true,
        lifecycleStage: true,
      },
      orderBy: [{ name: "asc" }],
      take: 20,
    }),
    getOrgSettings(),
  ]);

  const currencySymbol = getCurrencySymbol(orgSettings.baseCurrency);

  // Resolve the booked item's display name (e.g. "Table for 2") so the owner sees
  // WHAT was reserved, not just a ref (BI-3DA1DFDC). booking.itemId is the
  // StorefrontItem cuid.
  const bookingItemIds = [...new Set(bookings.map((b) => b.itemId))];
  const itemNameById = new Map(
    (
      await prisma.storefrontItem.findMany({
        where: { id: { in: bookingItemIds } },
        select: { id: true, name: true },
      })
    ).map((item) => [item.id, item.name]),
  );

  type InboxEntry = {
    id: string;
    ref: string;
    name: string | null;
    email: string;
    type: string;
    detail: string;
    createdAt: string;
    createdLabel: string;
    providerName: string | null;
    status: string;
    backlogItemId?: string | null;
    // Reservation handoff fields (bookings only).
    itemName?: string | null;
    covers?: number | null;
    dietaryNotes?: string | null;
    whenLabel?: string;
    timeLabel?: string;
    nextAction?: string;
  };

  const inquiryBacklogItemIds = new Map(
    (
      await prisma.backlogItem.findMany({
        where: {
          itemId: {
            in: inquiries.map((inquiry) => `BI-SFI-${inquiry.inquiryRef.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()}`),
          },
        },
        select: {
          itemId: true,
        },
      })
    ).map((item) => [item.itemId, item.itemId]),
  );

  const entries: InboxEntry[] = [
    ...inquiries.map((inquiry) => ({
      id: inquiry.id,
      ref: inquiry.inquiryRef,
      name: inquiry.customerName,
      email: inquiry.customerEmail,
      type: "inquiry",
      detail: inquiry.message ?? "",
      createdAt: inquiry.createdAt.toISOString(),
      createdLabel: formatInboxCreatedDate(inquiry.createdAt, operatingTimezone),
      providerName: null,
      status: "",
      backlogItemId:
        inquiryBacklogItemIds.get(
          `BI-SFI-${inquiry.inquiryRef.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()}`,
        ) ?? null,
    })),
    ...bookings.map((booking) => {
      const when = formatReservationWhen(booking.scheduledAt, operatingTimezone);
      return {
        id: booking.id,
        ref: booking.bookingRef,
        name: booking.customerName,
        email: booking.customerEmail ?? "No email supplied",
        type: "booking",
        detail: when.whenLabel,
        createdAt: booking.createdAt.toISOString(),
        createdLabel: formatInboxCreatedDate(booking.createdAt, operatingTimezone),
        providerName: booking.provider?.name ?? null,
        status: booking.status,
        itemName: itemNameById.get(booking.itemId) ?? null,
        covers: booking.covers,
        dietaryNotes: booking.dietaryNotes,
        whenLabel: when.whenLabel,
        timeLabel: when.timeLabel,
        nextAction: nextActionForReservation(booking.status),
      };
    }),
    ...orders.map((order) => {
      // Fulfilment handoff (BI-115E0D1F): the owner sees who ordered, what, the
      // order's lane status, and the exact next action — same contract as
      // reservations.
      const itemSummary = summarizeOrderItems(order.items);
      return {
        id: order.id,
        ref: order.orderRef,
        name: order.customerName,
        email: order.customerEmail,
        type: "order",
        detail: `${currencySymbol}${order.totalAmount.toString()}`,
        createdAt: order.createdAt.toISOString(),
        createdLabel: formatInboxCreatedDate(order.createdAt, operatingTimezone),
        providerName: null,
        status: order.status,
        itemName: itemSummary,
        nextAction: nextActionForOrder(order.status),
      };
    }),
    ...donations.map((donation) => ({
      id: donation.id,
      ref: donation.donationRef,
      name: donation.donorName,
      email: donation.donorEmail,
      type: "donation",
      detail: `${currencySymbol}${donation.amount.toString()}`,
      createdAt: donation.createdAt.toISOString(),
      createdLabel: formatInboxCreatedDate(donation.createdAt, operatingTimezone),
      providerName: null,
      status: "",
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const defaultDigitalProduct =
    digitalProducts.find((product) => product.name === "Open Digital Product Factory") ??
    digitalProducts[0] ??
    null;

  return (
    <StorefrontInbox
      entries={entries}
      providers={providerList}
      defaultDigitalProduct={
        defaultDigitalProduct
          ? { id: defaultDigitalProduct.id, name: defaultDigitalProduct.name }
          : null
      }
    />
  );
}
