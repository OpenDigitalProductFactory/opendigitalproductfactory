import type { PublicDisplayObligation } from "@/lib/storefront/storefront-types";

// Regulatory disclosures band for banking-financial-services storefronts
// (BI-5D9DCDE6 spec §9.3). Renders ONLY confirmed display obligations — the
// D5 honesty rule: with no captured regulatory posture this renders a neutral
// placeholder, never a fabricated "Member FDIC" / NCUA / Equal Housing claim.
export function DisclosuresSection({
  title,
  obligations,
}: {
  title: string | null;
  obligations: PublicDisplayObligation[];
}) {
  return (
    <div style={{ padding: "32px 0", borderTop: "1px solid var(--dpf-border)" }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
        {title ?? "Disclosures"}
      </h2>
      {obligations.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--dpf-muted)", lineHeight: 1.6 }}>
          Regulatory disclosures for this institution will appear here.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {obligations.map((obligation) => (
            <li key={obligation.displayObligationId} style={{ fontSize: 12, color: "var(--dpf-muted)", lineHeight: 1.6 }}>
              {obligation.text ?? obligation.displayType}
              {obligation.licenseNumber ? ` — ${obligation.licenseNumber}` : null}
              {obligation.authorityName ? (
                <span style={{ display: "block", fontSize: 11, color: "var(--dpf-muted)", opacity: 0.8 }}>
                  {obligation.authorityName}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
