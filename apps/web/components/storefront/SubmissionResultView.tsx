import type { SubmissionResultModel } from "@/lib/storefront/submission-result";

/**
 * Branded, accessible result surface for a completed customer submission
 * (BI-F20763F5). Pure presentational component — all data is resolved by
 * `loadSubmissionResult`, so this renders identically under test and in the
 * storefront layout, inheriting the storefront brand/nav from that layout.
 */
export function SubmissionResultView({ result }: { result: SubmissionResultModel }) {
  const { icon, heading, ref, orgName, context, responseChannel, responseTime, nextSteps, contact } =
    result;

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "48px 0" }}>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div style={{ fontSize: 44, marginBottom: 8 }} aria-hidden="true">
          {icon}
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>{heading}</h1>
        <p style={{ color: "var(--dpf-muted)", fontSize: 14 }}>
          Your reference is{" "}
          <strong style={{ fontFamily: "monospace", color: "var(--dpf-text)" }}>{ref}</strong>. Please
          keep it handy.
        </p>
      </div>

      {/* What you submitted */}
      {context.length > 0 && (
        <section
          aria-label="What you submitted"
          className="border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]"
          style={{ borderRadius: 10, padding: "16px 18px", marginBottom: 16 }}
        >
          <h2 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>What you submitted</h2>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 14px", margin: 0 }}>
            {context.map((line) => (
              <div key={line.label} style={{ display: "contents" }}>
                <dt className="text-[var(--dpf-muted)]" style={{ fontSize: 13 }}>
                  {line.label}
                </dt>
                <dd style={{ fontSize: 13, margin: 0, whiteSpace: "pre-wrap" }}>{line.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* Response channel + time */}
      <section
        aria-label="When you'll hear from us"
        style={{ borderRadius: 10, padding: "4px 2px 16px", marginBottom: 8 }}
      >
        <p style={{ fontSize: 14, marginBottom: 4 }}>{responseChannel}</p>
        <p className="text-[var(--dpf-muted)]" style={{ fontSize: 13 }}>
          {responseTime}
        </p>
      </section>

      {/* What happens next */}
      <section aria-label="What happens next" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>What happens next</h2>
        <ol style={{ paddingLeft: 20, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {nextSteps.map((step, i) => (
            <li key={i} style={{ fontSize: 13, lineHeight: 1.5 }}>
              {step}
            </li>
          ))}
        </ol>
      </section>

      {/* Correction / cancel / contact */}
      <section
        aria-label="Need to change or cancel"
        className="border border-[var(--dpf-border)]"
        style={{ borderRadius: 10, padding: "14px 18px", marginBottom: 24 }}
      >
        <h2 style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
          Need to change or cancel?
        </h2>
        <p className="text-[var(--dpf-muted)]" style={{ fontSize: 13, marginBottom: contact.email || contact.phone ? 8 : 0 }}>
          Reply to our confirmation email, or contact the {orgName} team with your reference{" "}
          <strong style={{ fontFamily: "monospace", color: "var(--dpf-text)" }}>{ref}</strong>.
        </p>
        {(contact.email || contact.phone) && (
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {contact.email && (
              <a href={`mailto:${contact.email}`} style={{ fontSize: 13, color: "var(--dpf-accent)" }}>
                ✉️ {contact.email}
              </a>
            )}
            {contact.phone && (
              <a href={`tel:${contact.phone}`} style={{ fontSize: 13, color: "var(--dpf-accent)" }}>
                📞 {contact.phone}
              </a>
            )}
          </div>
        )}
      </section>

      <div style={{ textAlign: "center" }}>
        <a
          href={`/s/${result.orgSlug}`}
          className="border border-[var(--dpf-border)]"
          style={{ display: "inline-block", padding: "8px 18px", borderRadius: 8, fontSize: 14, color: "var(--dpf-text)" }}
        >
          Back to {orgName}
        </a>
      </div>
    </div>
  );
}
