import { SignInForm } from "@/components/storefront/SignInForm";
import { resolveOrgSlug } from "@/lib/storefront-data";

export default async function PortalSignInPage() {
  // Resolve the single install's org slug so "Create an account" links
  // straight to the working storefront-scoped sign-up flow instead of
  // bouncing through the generic /portal/sign-up redirect (BI-C764BE03).
  const orgSlug = await resolveOrgSlug();
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--dpf-bg)",
      padding: 20,
    }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--dpf-text)", marginBottom: 24, textAlign: "center" }}>
          Customer sign in
        </h1>
        <SignInForm orgSlug={orgSlug ?? undefined} />
      </div>
    </div>
  );
}
