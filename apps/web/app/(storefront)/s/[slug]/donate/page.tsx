import { notFound } from "next/navigation";
import { getPublicStorefront } from "@/lib/storefront-data";
import { DonationForm } from "@/components/storefront/DonationForm";

export default async function DonatePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const storefront = await getPublicStorefront(slug);
  if (!storefront) notFound();

  return (
    <div style={{ paddingTop: 40, maxWidth: 520 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Make a Donation</h1>
      <p style={{ color: "#6b7280", marginBottom: 24, fontSize: 14 }}>
        Your support makes a real difference. Thank you.
      </p>
      <DonationForm orgSlug={slug} />
    </div>
  );
}
