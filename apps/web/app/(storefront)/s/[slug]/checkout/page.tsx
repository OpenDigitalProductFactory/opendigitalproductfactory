import { notFound } from "next/navigation";
import { prisma } from "@dpf/db";

const TYPE_LABELS: Record<string, { title: string; icon: string }> = {
  booking: { title: "Booking confirmed!", icon: "📅" },
  inquiry: { title: "Enquiry received!", icon: "✉️" },
  order: { title: "Order placed!", icon: "📦" },
  donation: { title: "Thank you for your donation!", icon: "❤️" },
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

  if (type === "booking") {
    const tx = await prisma.storefrontBooking.findFirst({
      where: { bookingRef: ref, storefrontId },
      select: { id: true },
    });
    refValid = !!tx;
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

  const meta = TYPE_LABELS[type] ?? { title: "Confirmed!", icon: "✓" };

  return (
    <div style={{ textAlign: "center", padding: "80px 0" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>{meta.icon}</div>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>{meta.title}</h1>
      <p style={{ color: "#6b7280", fontSize: 15, marginBottom: 4 }}>
        Reference: <strong>{ref}</strong>
      </p>
      <p style={{ color: "#6b7280", fontSize: 14 }}>
        {"We'll be in touch shortly. You can return to "}
        <a href={`/s/${slug}`} style={{ color: "var(--dpf-accent, #4f46e5)" }}>
          the storefront
        </a>.
      </p>
    </div>
  );
}
