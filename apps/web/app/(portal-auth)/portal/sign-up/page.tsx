import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveOrgSlug } from "@/lib/storefront-data";

// Generic customer sign-up entry point (BI-C764BE03). This install is
// single-org (see resolveOrgSlug's own doc comment — it backs the legacy
// /customer-* 301 redirects for exactly this reason), so the org slug is
// always resolvable once an Organization row exists. Rather than duplicate
// the storefront-scoped sign-up form, forward straight to the working
// /s/[slug]/sign-up flow it already reuses for /s/[slug]/sign-in.
//
// The only case that can't redirect is a brand-new, not-yet-configured
// install with no Organization row yet — that gets a customer-safe message
// here instead of a redirect to nowhere (kept local to this page; this is
// not the generic 404 page covered by the separate public-recovery BI).
export default async function PortalSignUpPage() {
  const orgSlug = await resolveOrgSlug();
  if (orgSlug) {
    redirect(`/s/${orgSlug}/sign-up`);
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--dpf-bg)",
        padding: 20,
      }}
    >
      <div style={{ width: "100%", maxWidth: 400, textAlign: "center" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--dpf-text)", marginBottom: 12 }}>
          Account sign-up isn&apos;t available yet
        </h1>
        <p style={{ fontSize: 14, color: "var(--dpf-muted)", marginBottom: 24 }}>
          This business hasn&apos;t finished setting up its storefront, so new customer accounts can&apos;t be
          created yet. Please check back shortly or contact the business directly.
        </p>
        <Link href="/portal/sign-in" style={{ color: "var(--dpf-accent)", fontSize: 13, textDecoration: "none" }}>
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
