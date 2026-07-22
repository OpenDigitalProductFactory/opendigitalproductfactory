import { notFound } from "next/navigation";
import { prisma } from "@dpf/db";
import { getPublicStorefront } from "@/lib/storefront-data";
import { getCurrencySymbol } from "@/lib/finance/currency-symbol";
import { isJourneySupported } from "@/lib/storefront/public-trust";
import { DonationForm } from "@/components/storefront/DonationForm";
import { StorefrontUnavailable } from "@/components/storefront/StorefrontUnavailable";

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

  // Donations are only offered when the business has configured a donation appeal.
  // A restaurant (or any venue without one) must not present a live donation form
  // with generic "your support makes a difference" copy — recover the customer
  // back into the storefront instead.
  if (!isJourneySupported(storefront, "donation")) {
    return (
      <StorefrontUnavailable
        orgSlug={slug}
        orgName={storefront.orgName}
        title="Donations aren't set up here"
        message={`${storefront.orgName} isn't accepting online donations right now. If you'd like to support or get in touch, send us a message.`}
      />
    );
  }

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
