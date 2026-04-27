import { prisma } from "@dpf/db";
import { redirect } from "next/navigation";
import { StorefrontInbox } from "@/components/storefront-admin/StorefrontInbox";

export default async function InboxPage() {
  const config = await prisma.storefrontConfig.findFirst({ select: { id: true } });
  if (!config) redirect("/storefront/setup");

  const [inquiries, bookings, orders, donations, providerList, digitalProducts] = await Promise.all([
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
        customerName: true,
        customerEmail: true,
        scheduledAt: true,
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
        customerEmail: true,
        totalAmount: true,
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
  ]);

  type InboxEntry = {
    id: string;
    ref: string;
    name: string | null;
    email: string;
    type: string;
    detail: string;
    createdAt: string;
    providerName: string | null;
    status: string;
    backlogItemId?: string | null;
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
      providerName: null,
      status: "",
      backlogItemId:
        inquiryBacklogItemIds.get(
          `BI-SFI-${inquiry.inquiryRef.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()}`,
        ) ?? null,
    })),
    ...bookings.map((booking) => ({
      id: booking.id,
      ref: booking.bookingRef,
      name: booking.customerName,
      email: booking.customerEmail,
      type: "booking",
      detail: booking.scheduledAt.toLocaleDateString("en-GB"),
      createdAt: booking.createdAt.toISOString(),
      providerName: booking.provider?.name ?? null,
      status: booking.status,
    })),
    ...orders.map((order) => ({
      id: order.id,
      ref: order.orderRef,
      name: null,
      email: order.customerEmail,
      type: "order",
      detail: `£${order.totalAmount.toString()}`,
      createdAt: order.createdAt.toISOString(),
      providerName: null,
      status: "",
    })),
    ...donations.map((donation) => ({
      id: donation.id,
      ref: donation.donationRef,
      name: donation.donorName,
      email: donation.donorEmail,
      type: "donation",
      detail: `£${donation.amount.toString()}`,
      createdAt: donation.createdAt.toISOString(),
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
