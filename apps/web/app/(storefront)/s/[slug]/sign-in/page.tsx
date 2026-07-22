import Link from "next/link";
import { getPublicStorefront } from "@/lib/storefront-data";
import { resolveTrustProfile } from "@/lib/storefront/public-trust";
import { SignInForm } from "@/components/storefront/SignInForm";

export default async function StorefrontSignInPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // getPublicStorefront is React-cached, so this reuses the layout's fetch.
  const storefront = await getPublicStorefront(slug, { includeUnpublished: true });
  const orgName = storefront?.orgName;
  const trust = storefront ? resolveTrustProfile(storefront.archetypeCategory) : null;

  return (
    <div style={{ paddingTop: 60, width: "100%", maxWidth: 400, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, overflowWrap: "break-word", color: "var(--dpf-text)" }}>
        {orgName ? `Sign in to ${orgName}` : "Sign in"}
      </h1>
      {trust && (
        <p style={{ fontSize: 14, color: "var(--dpf-muted)", marginBottom: 24 }}>
          Access your account to {trust.accountPurpose}.
        </p>
      )}
      <SignInForm orgSlug={slug} />
      <p style={{ marginTop: 20, fontSize: 12, color: "var(--dpf-muted)" }}>
        By signing in you agree to our{" "}
        <Link href={`/s/${slug}/policies#terms`} style={{ color: "var(--dpf-accent)" }}>terms</Link>
        {" and "}
        <Link href={`/s/${slug}/policies#privacy`} style={{ color: "var(--dpf-accent)" }}>privacy notice</Link>.
      </p>
    </div>
  );
}
