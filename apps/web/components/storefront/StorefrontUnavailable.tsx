import Link from "next/link";

/**
 * Customer-safe "this isn't available here" panel for public storefront journeys
 * that the business hasn't configured (e.g. a donation or order path on a venue
 * that only takes reservations). Unlike the internal 404, every recovery link
 * points back into the customer's own storefront — never the workspace or docs.
 */
export function StorefrontUnavailable({
  orgSlug,
  orgName,
  title = "This isn't available here",
  message,
}: {
  orgSlug: string;
  orgName?: string;
  title?: string;
  message: string;
}) {
  const linkBase = {
    display: "inline-block",
    padding: "10px 18px",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    textDecoration: "none",
  } as const;

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "64px 0", textAlign: "center" }}>
      <div
        aria-hidden="true"
        style={{
          margin: "0 auto 16px",
          width: 44,
          height: 44,
          borderRadius: "50%",
          border: "1px solid var(--dpf-border)",
          background: "var(--dpf-surface-2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
        }}
      >
        🔎
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: "var(--dpf-text)" }}>{title}</h1>
      <p style={{ color: "var(--dpf-muted)", fontSize: 15, lineHeight: 1.6, marginBottom: 24 }}>{message}</p>
      <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
        <Link
          href={`/s/${orgSlug}`}
          style={{ ...linkBase, background: "var(--dpf-accent)", color: "var(--dpf-surface-1)" }}
        >
          {orgName ? `Back to ${orgName}` : "Back to home"}
        </Link>
        <Link
          href={`/s/${orgSlug}/inquire`}
          style={{
            ...linkBase,
            border: "1px solid var(--dpf-border)",
            color: "var(--dpf-text)",
            background: "var(--dpf-surface-1)",
          }}
        >
          Contact us
        </Link>
      </div>
    </div>
  );
}
