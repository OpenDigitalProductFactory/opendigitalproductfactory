import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublicStorefront, getPublicItem } from "@/lib/storefront-data";
import { resolveTrustProfile } from "@/lib/storefront/public-trust";
import { CtaButton } from "@/components/storefront/CtaButton";

/** One line explaining what taking this action commits the customer to. */
function whatHappensNext(ctaType: string, bookingNoun: string): string {
  switch (ctaType) {
    case "booking":
      return `Choose a time and share your details — we'll confirm your ${bookingNoun} before it's held. You won't be charged to request a time.`;
    case "purchase":
      return "You'll see the price and can review your order before you pay. Card details are entered on a secure step.";
    case "donation":
      return "You'll be able to choose an amount before confirming. Thank you for your support.";
    default:
      return "Send us a few details and we'll get back to you — there's no commitment.";
  }
}

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ slug: string; itemId: string }>;
}) {
  const { slug, itemId } = await params;
  const [storefront, item] = await Promise.all([
    getPublicStorefront(slug),
    getPublicItem(slug, itemId),
  ]);

  if (!storefront || !item) notFound();

  const trust = resolveTrustProfile(storefront.archetypeCategory, storefront.archetypeId);
  const nextLine = whatHappensNext(item.ctaType, trust.bookingNoun);

  return (
    <div style={{ maxWidth: 600, paddingTop: 40 }}>
      {item.imageUrl && (
        <img src={item.imageUrl} alt={item.name}
          style={{ width: "100%", borderRadius: 8, marginBottom: 24 }} />
      )}
      <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--dpf-text)" }}>{item.name}</h1>
      {item.description && (
        <p style={{ color: "var(--dpf-muted)", lineHeight: 1.75, marginTop: 12 }}>{item.description}</p>
      )}

      <div
        style={{
          marginTop: 20,
          padding: "14px 16px",
          borderRadius: 10,
          border: "1px solid var(--dpf-border)",
          background: "var(--dpf-surface-1)",
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--dpf-muted)", marginBottom: 6 }}>
          What happens next
        </div>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--dpf-text)", margin: 0 }}>{nextLine}</p>
      </div>

      <div style={{ marginTop: 20 }}>
        <CtaButton ctaType={item.ctaType} ctaLabel={item.ctaLabel} orgSlug={slug} itemId={item.itemId} priceAmount={item.priceAmount} itemName={item.name} />
      </div>

      <p style={{ marginTop: 16, fontSize: 13, color: "var(--dpf-muted)" }}>
        {trust.contactPrompt}{" "}
        <Link href={`/s/${slug}/inquire`} style={{ color: "var(--dpf-accent)" }}>Contact {storefront.orgName}</Link>
        {" · "}
        <Link href={`/s/${slug}/policies`} style={{ color: "var(--dpf-accent)" }}>{trust.policyLinkLabel} policy</Link>
      </p>
    </div>
  );
}
