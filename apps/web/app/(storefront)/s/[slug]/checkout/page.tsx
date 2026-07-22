import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@dpf/db";

const TYPE_LABELS: Record<string, { title: string; icon: string; next: string }> = {
  booking: {
    title: "Booking request received",
    icon: "📅",
    next: "We'll review your request and confirm your booking by email or phone. Keep your reference in case you need to change it.",
  },
  inquiry: {
    title: "Enquiry received",
    icon: "✉️",
    next: "Thanks for getting in touch — we've received your message and will reply as soon as we can, usually within one business day.",
  },
  order: {
    title: "Order placed",
    icon: "📦",
    next: "We've received your order and will be in touch with confirmation and next steps.",
  },
  donation: {
    title: "Thank you for your donation",
    icon: "❤️",
    next: "Your support means a great deal. A receipt will be sent to your email.",
  },
};

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ref?: string; type?: string }>;
}) {
  const { slug } = await params;
  const { ref, type } = await searchParams;

  if (!ref || !type) notFound();

  const storefrontConfig = await prisma.storefrontConfig.findFirst({
    where: { organization: { slug } },
    select: { id: true },
  });
  if (!storefrontConfig) notFound();

  const storefrontId = storefrontConfig.id;
  let refValid = false;
  let bookingDetail: { scheduledAt: Date; durationMinutes: number; customerName: string } | null = null;

  if (type === "booking") {
    const tx = await prisma.storefrontBooking.findFirst({
      where: { bookingRef: ref, storefrontId },
      select: { id: true, scheduledAt: true, durationMinutes: true, customerName: true },
    });
    refValid = !!tx;
    if (tx) bookingDetail = { scheduledAt: tx.scheduledAt, durationMinutes: tx.durationMinutes, customerName: tx.customerName };
  } else if (type === "inquiry") {
    const tx = await prisma.storefrontInquiry.findFirst({
      where: { inquiryRef: ref, storefrontId },
      select: { id: true },
    });
    refValid = !!tx;
  } else if (type === "donation") {
    const tx = await prisma.storefrontDonation.findFirst({
      where: { donationRef: ref, storefrontId },
      select: { id: true },
    });
    refValid = !!tx;
  } else if (type === "order") {
    const tx = await prisma.storefrontOrder.findFirst({
      where: { orderRef: ref, storefrontId },
      select: { id: true },
    });
    refValid = !!tx;
  }

  if (!refValid) notFound();

  const meta = TYPE_LABELS[type] ?? {
    title: "Received",
    icon: "✓",
    next: "We've received your request and will be in touch shortly.",
  };

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "72px 0", textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }} aria-hidden="true">{meta.icon}</div>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12, color: "var(--dpf-text)" }}>{meta.title}</h1>
      <div
        style={{
          display: "inline-block",
          padding: "6px 14px",
          borderRadius: 999,
          border: "1px solid var(--dpf-border)",
          background: "var(--dpf-surface-1)",
          fontSize: 14,
          color: "var(--dpf-text)",
          marginBottom: 16,
        }}
      >
        Reference <strong>{ref}</strong>
      </div>
      {bookingDetail && (
        <p style={{ color: "var(--dpf-text)", fontSize: 15, marginBottom: 12 }}>
          {bookingDetail.customerName ? `${bookingDetail.customerName} · ` : ""}
          {new Date(bookingDetail.scheduledAt).toLocaleString(undefined, {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
          {` · ${bookingDetail.durationMinutes} min`}
        </p>
      )}
      <p style={{ color: "var(--dpf-muted)", fontSize: 15, lineHeight: 1.6, marginBottom: 24 }}>
        {meta.next}
      </p>
      <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
        <Link
          href={`/s/${slug}`}
          style={{
            display: "inline-block",
            padding: "10px 18px",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            textDecoration: "none",
            background: "var(--dpf-accent)",
            color: "var(--dpf-surface-1)",
          }}
        >
          Back to home
        </Link>
        <Link
          href={`/s/${slug}/inquire`}
          style={{
            display: "inline-block",
            padding: "10px 18px",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            textDecoration: "none",
            border: "1px solid var(--dpf-border)",
            color: "var(--dpf-text)",
            background: "var(--dpf-surface-1)",
          }}
        >
          Need to change something?
        </Link>
      </div>
    </div>
  );
}
