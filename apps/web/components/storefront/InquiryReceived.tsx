import { Fragment } from "react";
import Link from "next/link";

export type SubmittedDetail = { label: string; value: string };

/**
 * Customer-facing inquiry success result (BI-F20763F5). Replaces the thin
 * checkout-style confirmation with the full submit-result contract: what the
 * customer sent, the reference, the response channel + expected time, what
 * happens next, and how to correct/cancel/contact. Pure presentational
 * component (no client state, no I/O) so it renders on the server and is
 * deterministically testable.
 *
 * Copy is deliberately honest: no confirmation email is claimed because the
 * inquiry flow does not send one — the business replies from the inbox.
 */
export function InquiryReceived({
  orgName,
  orgSlug,
  reference,
  customerName,
  customerEmail,
  details,
  contactEmail,
  contactPhone,
}: {
  orgName: string;
  orgSlug: string;
  reference: string;
  customerName: string | null;
  customerEmail: string;
  /** Ordered submitted context rows (item, message, party size, etc.). */
  details: SubmittedDetail[];
  /** Business contact channels for corrections/cancellations, if configured. */
  contactEmail: string | null;
  contactPhone: string | null;
}) {
  const greetingName = customerName?.trim() ? customerName.trim().split(/\s+/)[0] : null;
  const subject = `Enquiry ${reference}`;
  const correctionBody = `Hi, I'd like to update or cancel my enquiry (reference ${reference}).`;

  return (
    <div style={{ paddingTop: 40, maxWidth: 560, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ fontSize: 44, marginBottom: 12 }} aria-hidden="true">✉️</div>
        <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>
          {greetingName ? `Thanks, ${greetingName} — your enquiry is in` : "Your enquiry is in"}
        </h1>
        <p style={{ color: "var(--dpf-muted)", fontSize: 14 }}>
          {`${orgName} has received your enquiry. Keep your reference in case you need to get in touch.`}
        </p>
      </div>

      <section
        aria-label="Your reference"
        style={{
          border: "1px solid var(--dpf-border)",
          borderRadius: 10,
          padding: "14px 16px",
          textAlign: "center",
          marginBottom: 20,
          background: "var(--dpf-surface-2)",
        }}
      >
        <div style={{ fontSize: 12, color: "var(--dpf-muted)", marginBottom: 4 }}>Reference</div>
        <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "monospace", letterSpacing: 1 }}>
          {reference}
        </div>
      </section>

      <section
        aria-label="What you sent us"
        style={{ border: "1px solid var(--dpf-border)", borderRadius: 10, padding: "16px 18px", marginBottom: 20 }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>What you sent us</h2>
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 16px", margin: 0, fontSize: 14 }}>
          {customerName && (
            <>
              <dt style={{ color: "var(--dpf-muted)" }}>Name</dt>
              <dd style={{ margin: 0 }}>{customerName}</dd>
            </>
          )}
          <dt style={{ color: "var(--dpf-muted)" }}>Email</dt>
          <dd style={{ margin: 0 }}>{customerEmail}</dd>
          {details.map((d) => (
            <Fragment key={d.label}>
              <dt style={{ color: "var(--dpf-muted)" }}>{d.label}</dt>
              <dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>{d.value}</dd>
            </Fragment>
          ))}
        </dl>
      </section>

      <section
        aria-label="What happens next"
        style={{ border: "1px solid var(--dpf-border)", borderRadius: 10, padding: "16px 18px", marginBottom: 20 }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>What happens next</h2>
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 14, display: "flex", flexDirection: "column", gap: 6 }}>
          <li>{`The ${orgName} team will review your enquiry.`}</li>
          <li>
            {"They'll reply to you by email at "}
            <strong>{customerEmail}</strong>
            {" — usually within one business day."}
          </li>
          <li>{"No payment is taken for an enquiry, and nothing is booked yet."}</li>
        </ol>
      </section>

      <section
        aria-label="Need to make a change?"
        style={{ border: "1px solid var(--dpf-border)", borderRadius: 10, padding: "16px 18px", marginBottom: 24 }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Need to change or cancel?</h2>
        {contactEmail || contactPhone ? (
          <p style={{ margin: 0, fontSize: 14, color: "var(--dpf-muted)" }}>
            {`Contact ${orgName} and quote reference `}
            <strong>{reference}</strong>:
            <span style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
              {contactEmail && (
                <a
                  href={`mailto:${contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(correctionBody)}`}
                  style={{ color: "var(--dpf-accent)", fontWeight: 600 }}
                >
                  {contactEmail}
                </a>
              )}
              {contactPhone && (
                <a href={`tel:${contactPhone.replace(/\s+/g, "")}`} style={{ color: "var(--dpf-accent)", fontWeight: 600 }}>
                  {contactPhone}
                </a>
              )}
            </span>
          </p>
        ) : (
          <p style={{ margin: 0, fontSize: 14, color: "var(--dpf-muted)" }}>
            {`To change or cancel, reply to the team's email when they get in touch, and quote reference `}
            <strong>{reference}</strong>.
          </p>
        )}
      </section>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Link
          href={`/s/${orgSlug}`}
          style={{
            padding: "10px 18px", borderRadius: 6, fontSize: 14, fontWeight: 600,
            background: "var(--dpf-accent)", color: "var(--dpf-on-accent)", textDecoration: "none",
          }}
        >
          {`Back to ${orgName}`}
        </Link>
        <Link
          href={`/s/${orgSlug}/inquire`}
          style={{
            padding: "10px 18px", borderRadius: 6, fontSize: 14, fontWeight: 600,
            border: "1px solid var(--dpf-border)", color: "var(--dpf-text)", textDecoration: "none",
          }}
        >
          Send another enquiry
        </Link>
      </div>
    </div>
  );
}
