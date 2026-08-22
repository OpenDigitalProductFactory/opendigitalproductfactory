import { formatOrgAddressLines } from "@/lib/shared/org-address";
import Link from "next/link";
import type { PublicStorefrontConfig } from "@/lib/storefront-types";
import type { WeeklySchedule } from "@/lib/operating-hours-types";
import { resolveTrustProfile } from "@/lib/storefront/public-trust";

const DAYS: { key: keyof WeeklySchedule; label: string }[] = [
  { key: "monday", label: "Mon" },
  { key: "tuesday", label: "Tue" },
  { key: "wednesday", label: "Wed" },
  { key: "thursday", label: "Thu" },
  { key: "friday", label: "Fri" },
  { key: "saturday", label: "Sat" },
  { key: "sunday", label: "Sun" },
];

/**
 * Site-wide trust footer for every public storefront page. Surfaces the
 * customer-safety cues an anonymous visitor needs to trust the business:
 * who they're dealing with, where it is, how to reach it, when it's open,
 * and where the booking/cancellation, privacy and terms policies live.
 *
 * Presentational only — the layout resolves the storefront + hours and passes
 * them in, so this renders in any environment (and is trivially testable).
 */
export function StorefrontTrustFooter({
  storefront,
  hours,
}: {
  storefront: Pick<
    PublicStorefrontConfig,
    "orgName" | "orgSlug" | "orgAddress" | "contactEmail" | "contactPhone" | "socialLinks" | "timezone"
  > & Partial<Pick<PublicStorefrontConfig, "archetypeId" | "archetypeCategory">>;
  hours: WeeklySchedule | null;
}) {
  const { orgSlug, orgAddress } = storefront;
  const trust = resolveTrustProfile(storefront.archetypeCategory, storefront.archetypeId);
  // Use the canonical formatter rather than an ad-hoc join. Both storefront
  // surfaces previously hand-joined a subset of keys and DROPPED the state/region:
  // a Fort Worth address with stateCode "TX" rendered "Fort Worth, 76106" here and
  // "Fort Worth, 76106, United States" in ContactSection — two different wrong
  // answers from two copies of the same logic (IMP-034). formatOrgAddressLines
  // covers both the legacy street/postcode keys and line1/postalCode, and includes
  // region/state.
  const addressLine = orgAddress ? formatOrgAddressLines(orgAddress).join(", ") || null : null;
  const socials = Object.entries(storefront.socialLinks ?? {}).filter(
    ([, url]) => typeof url === "string" && url.length > 0,
  ) as [string, string][];

  const labelStyle = {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "var(--dpf-muted)",
    marginBottom: 6,
  };
  const linkStyle = { color: "var(--dpf-text)", textDecoration: "none" };

  return (
    <footer
      style={{
        borderTop: "1px solid var(--dpf-border)",
        background: "var(--dpf-surface-1)",
        color: "var(--dpf-text)",
        marginTop: 48,
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "32px 24px",
          display: "grid",
          gap: 28,
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        }}
      >
        {/* Identity + location */}
        <div>
          <div style={labelStyle}>{storefront.orgName}</div>
          {addressLine ? (
            <address style={{ fontStyle: "normal", fontSize: 14, lineHeight: 1.6, color: "var(--dpf-text)" }}>
              {addressLine}
            </address>
          ) : (
            <p style={{ fontSize: 13, color: "var(--dpf-muted)", margin: 0 }}>
              Contact us for location details.
            </p>
          )}
        </div>

        {/* Contact */}
        <div>
          <div style={labelStyle}>Contact</div>
          <div style={{ fontSize: 14, lineHeight: 1.8 }}>
            {storefront.contactEmail && (
              <div>
                <a href={`mailto:${storefront.contactEmail}`} style={linkStyle}>
                  {storefront.contactEmail}
                </a>
              </div>
            )}
            {storefront.contactPhone && (
              <div>
                <a href={`tel:${storefront.contactPhone}`} style={linkStyle}>
                  {storefront.contactPhone}
                </a>
              </div>
            )}
            {!storefront.contactEmail && !storefront.contactPhone && (
              <Link href={`/s/${orgSlug}/inquire`} style={linkStyle}>
                Send us a message
              </Link>
            )}
          </div>
        </div>

        {/* Opening hours */}
        <div>
          <div style={labelStyle}>Opening hours</div>
          {hours ? (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 13, lineHeight: 1.7 }}>
              {DAYS.map(({ key, label }) => {
                const day = hours[key];
                return (
                  <li key={key} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ color: "var(--dpf-muted)" }}>{label}</span>
                    <span>{day.enabled ? `${day.open}–${day.close}` : "Closed"}</span>
                  </li>
                );
              })}
              <li style={{ marginTop: 6, color: "var(--dpf-muted)", fontSize: 12 }}>
                Times shown in {storefront.timezone}
              </li>
            </ul>
          ) : (
            <p style={{ fontSize: 13, color: "var(--dpf-muted)", margin: 0 }}>
              Contact us for current opening hours.
            </p>
          )}
        </div>

        {/* Policies + follow */}
        <div>
          <div style={labelStyle}>Policies &amp; help</div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 14, lineHeight: 1.9 }}>
            <li>
              <Link href={`/s/${orgSlug}/policies`} style={linkStyle}>
                {trust.policyLinkLabel}
              </Link>
            </li>
            <li>
              <Link href={`/s/${orgSlug}/policies#privacy`} style={linkStyle}>
                Privacy
              </Link>
            </li>
            <li>
              <Link href={`/s/${orgSlug}/policies#terms`} style={linkStyle}>
                Terms
              </Link>
            </li>
            <li>
              <Link href={`/s/${orgSlug}/inquire`} style={linkStyle}>
                Contact us
              </Link>
            </li>
          </ul>
          {socials.length > 0 && (
            <div style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap", fontSize: 13 }}>
              {socials.map(([name, url]) => (
                <a
                  key={name}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  style={{ color: "var(--dpf-muted)", textTransform: "capitalize" }}
                >
                  {name}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}
