"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function StorefrontNav({
  orgName,
  orgLogoUrl,
  orgSlug,
}: {
  orgName: string;
  orgLogoUrl: string | null;
  orgSlug: string;
}) {
  // Capture where the customer is browsing (an item/booking/inquiry/order
  // page) so sign-in can hand them back to it instead of the internal
  // /portal (BI-CC4BEB5F). Skip it when already on an auth page — self as
  // returnTo would just loop.
  const pathname = usePathname() ?? "";
  const isAuthRoute = pathname.endsWith("/sign-in") || pathname.endsWith("/sign-up");
  const signInHref =
    pathname && !isAuthRoute
      ? `/s/${orgSlug}/sign-in?returnTo=${encodeURIComponent(pathname)}`
      : `/s/${orgSlug}/sign-in`;

  return (
    <header style={{
      borderBottom: "1px solid var(--dpf-border)",
      padding: "8px 16px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      minHeight: 60,
      background: "var(--dpf-surface-1)",
    }}>
      <Link
        href={`/s/${orgSlug}`}
        style={{
          display: "flex", alignItems: "center", gap: 8, minWidth: 0,
          minHeight: 44, textDecoration: "none",
        }}
      >
        {orgLogoUrl && <img src={orgLogoUrl} alt={orgName} style={{ height: 32, width: "auto" }} />}
        <span style={{
          fontWeight: 700, fontSize: 18, color: "var(--dpf-text)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{orgName}</span>
      </Link>
      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        <Link
          href={signInHref}
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, padding: "8px 16px", minHeight: 44, borderRadius: 6,
            border: "1px solid var(--dpf-border)", color: "var(--dpf-text)", textDecoration: "none",
          }}
        >
          Sign in
        </Link>
      </div>
    </header>
  );
}
