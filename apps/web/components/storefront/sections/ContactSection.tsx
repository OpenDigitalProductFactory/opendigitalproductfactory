import type { PublicStorefrontConfig } from "@/lib/storefront-types";

export function ContactSection({
  storefront,
}: {
  storefront: Pick<PublicStorefrontConfig, "contactEmail" | "contactPhone" | "orgAddress" | "socialLinks">;
}) {
  return (
    <div style={{ padding: "40px 0", borderTop: "1px solid #e5e7eb" }}>
      <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
        {storefront.contactEmail && (
          <div>
            <span style={{ color: "#6b7280", fontSize: 12 }}>Email</span><br />
            <a href={`mailto:${storefront.contactEmail}`} style={{ color: "#111827" }}>{storefront.contactEmail}</a>
          </div>
        )}
        {storefront.contactPhone && (
          <div>
            <span style={{ color: "#6b7280", fontSize: 12 }}>Phone</span><br />
            <a href={`tel:${storefront.contactPhone}`} style={{ color: "#111827" }}>{storefront.contactPhone}</a>
          </div>
        )}
        {storefront.orgAddress && (
          <div>
            <span style={{ color: "#6b7280", fontSize: 12 }}>Address</span><br />
            <span style={{ color: "#111827" }}>
              {[storefront.orgAddress.street, storefront.orgAddress.city, storefront.orgAddress.postcode].filter(Boolean).join(", ")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
