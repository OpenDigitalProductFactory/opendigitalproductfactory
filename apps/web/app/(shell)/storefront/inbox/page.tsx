import { prisma } from "@dpf/db";
import { redirect } from "next/navigation";
import { StorefrontInbox } from "@/components/storefront-admin/StorefrontInbox";

export default async function InboxPage() {
  const config = await prisma.storefrontConfig.findFirst({ select: { id: true } });
  if (!config) redirect("/storefront/setup");

  const [inquiries, bookings, orders, donations] = await Promise.all([
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
        createdAt: true,
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
  ]);

  type InboxEntry = {
    id: string;
    ref: string;
    name: string | null;
    email: string;
    type: string;
    detail: string;
    createdAt: string;
  };

  const entries: InboxEntry[] = [
    ...inquiries.map((i) => ({
      id: i.id,
      ref: i.inquiryRef,
      name: i.customerName,
      email: i.customerEmail,
      type: "inquiry",
      detail: i.message ?? "",
      createdAt: i.createdAt.toISOString(),
    })),
    ...bookings.map((b) => ({
      id: b.id,
      ref: b.bookingRef,
      name: b.customerName,
      email: b.customerEmail,
      type: "booking",
      detail: b.scheduledAt.toLocaleDateString("en-GB"),
      createdAt: b.createdAt.toISOString(),
    })),
    ...orders.map((o) => ({
      id: o.id,
      ref: o.orderRef,
      name: null,
      email: o.customerEmail,
      type: "order",
      detail: `£${o.totalAmount.toString()}`,
      createdAt: o.createdAt.toISOString(),
    })),
    ...donations.map((d) => ({
      id: d.id,
      ref: d.donationRef,
      name: d.donorName,
      email: d.donorEmail,
      type: "donation",
      detail: `£${d.amount.toString()}`,
      createdAt: d.createdAt.toISOString(),
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return <StorefrontInbox entries={entries} />;
}
