import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublicStorefront } from "@/lib/storefront-data";
import { resolveTrustProfile, isJourneySupported } from "@/lib/storefront/public-trust";

export default async function StorefrontPoliciesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const storefront = await getPublicStorefront(slug);
  if (!storefront) notFound();

  const trust = resolveTrustProfile(storefront.archetypeCategory);
  const takesPayment = isJourneySupported(storefront, "order");
  const contactBits = [storefront.contactEmail, storefront.contactPhone].filter(Boolean).join(" · ");

  const sectionStyle = { marginBottom: 32 } as const;
  const h2Style = { fontSize: 18, fontWeight: 700, marginBottom: 8, color: "var(--dpf-text)" } as const;
  const pStyle = { fontSize: 15, lineHeight: 1.7, color: "var(--dpf-muted)", margin: "0 0 8px" } as const;

  return (
    <div style={{ maxWidth: 720, paddingTop: 40 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8, color: "var(--dpf-text)" }}>
        Policies &amp; customer information
      </h1>
      <p style={{ ...pStyle, marginBottom: 32 }}>
        How {storefront.orgName} handles bookings, your information, and getting in touch.
      </p>

      <section id="booking" style={sectionStyle}>
        <h2 style={h2Style}>Booking &amp; cancellation</h2>
        <p style={pStyle}>{trust.bookingPolicy}</p>
        <p style={pStyle}>{trust.cancellationPolicy}</p>
      </section>

      {trust.dietaryNote && (
        <section id="dietary" style={sectionStyle}>
          <h2 style={h2Style}>Dietary &amp; allergens</h2>
          <p style={pStyle}>{trust.dietaryNote}</p>
        </section>
      )}

      <section id="payment" style={sectionStyle}>
        <h2 style={h2Style}>Payment &amp; security</h2>
        <p style={pStyle}>{trust.paymentNote}</p>
        {takesPayment && (
          <p style={pStyle}>
            When a payment is required, you&apos;ll see the amount before you confirm, and card
            details are entered on a secure payment step — never shared with us in a form or email.
          </p>
        )}
      </section>

      <section id="privacy" style={sectionStyle}>
        <h2 style={h2Style}>Privacy</h2>
        <p style={pStyle}>
          The details you enter (such as your name, contact details, and any notes) are used only to
          handle your booking, order, or enquiry with {storefront.orgName}. They are not sold, and
          are shared only as needed to fulfil your request.
        </p>
        <p style={pStyle}>
          To ask what information is held about you, or to have it corrected or removed, contact us
          {contactBits ? ` at ${contactBits}` : " using the details on this site"}.
        </p>
      </section>

      <section id="terms" style={sectionStyle}>
        <h2 style={h2Style}>Terms</h2>
        <p style={pStyle}>
          Submitting a booking or enquiry is a request, not a guaranteed reservation, until {storefront.orgName}{" "}
          confirms it. Prices, availability, and menus may change. These are the business&apos;s standard
          terms; contact us with any questions before you book.
        </p>
      </section>

      <p style={{ ...pStyle, marginTop: 24 }}>
        <Link href={`/s/${slug}`} style={{ color: "var(--dpf-accent)" }}>
          ← Back to {storefront.orgName}
        </Link>
      </p>
    </div>
  );
}
