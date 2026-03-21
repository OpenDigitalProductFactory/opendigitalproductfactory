import type { PublicStorefrontConfig } from "@/lib/storefront-types";

export function ContactSection({
  storefront,
}: {
  storefront: Pick<PublicStorefrontConfig, "contactEmail" | "contactPhone" | "orgAddress" | "socialLinks">;
}) {
  return (
    <div style={{ padding: "40px 0", borderTop: "1px solid var(--dpf-border)" }}>
      <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
        {storefront.contactEmail && (
          <div>
            <span style={{ color: "var(--dpf-muted)", fontSize: 12 }}>Email</span><br />
            <a href={`mailto:${storefront.contactEmail}`} style={{ color: "var(--dpf-text)" }}>{storefront.contactEmail}</a>
          </div>
        )}
        {storefront.contactPhone && (
          <div>
            <span style={{ color: "var(--dpf-muted)", fontSize: 12 }}>Phone</span><br />
            <a href={`tel:${storefront.contactPhone}`} style={{ color: "var(--dpf-text)" }}>{storefront.contactPhone}</a>
          </div>
        )}
        {storefront.orgAddress && (
          <div>
            <span style={{ color: "var(--dpf-muted)", fontSize: 12 }}>Address</span><br />
            <span style={{ color: "var(--dpf-text)" }}>
              {[storefront.orgAddress.street, storefront.orgAddress.city, storefront.orgAddress.postcode].filter(Boolean).join(", ")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
