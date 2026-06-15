import { notFound } from "next/navigation";
import { prisma } from "@dpf/db";
import { getPublicStorefront } from "@/lib/storefront-data";
import { getCurrencySymbol } from "@/lib/finance/currency-symbol";
import { DonationForm } from "@/components/storefront/DonationForm";

export default async function DonatePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [storefront, orgSettings] = await Promise.all([
    getPublicStorefront(slug),
    prisma.orgSettings.findFirst({ select: { baseCurrency: true } }),
  ]);
  if (!storefront) notFound();

  const currencySymbol = getCurrencySymbol(orgSettings?.baseCurrency ?? "USD");

  return (
    <div style={{ paddingTop: 40, maxWidth: 520 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Make a Donation</h1>
      <p style={{ color: "var(--dpf-muted)", marginBottom: 24, fontSize: 14 }}>
        Your support makes a real difference. Thank you.
      </p>
      <DonationForm orgSlug={slug} currencySymbol={currencySymbol} />
    </div>
  );
}
