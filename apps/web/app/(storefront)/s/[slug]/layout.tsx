import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicStorefront } from "@/lib/storefront-data";
import { getPublicOperatingHours } from "@/lib/storefront/public-trust";
import { buildBrandingStyleTag } from "@/lib/branding";
import { StorefrontNav } from "@/components/storefront/StorefrontNav";
import { StorefrontTrustFooter } from "@/components/storefront/StorefrontTrustFooter";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  // Public pages must carry the STOREFRONT's identity, not the platform's. Without
  // this the browser tab (and share previews) fall back to the root "Digital
  // Product Factory" title, so a customer never sees the business they're on.
  const storefront = await getPublicStorefront(slug, { includeUnpublished: true });
  if (!storefront) return { title: "Not found" };
  const description = storefront.tagline ?? storefront.description ?? undefined;
  return {
    title: { default: storefront.orgName, template: `%s · ${storefront.orgName}` },
    ...(description ? { description } : {}),
    openGraph: {
      title: storefront.orgName,
      ...(description ? { description } : {}),
      ...(storefront.orgLogoUrl ? { images: [{ url: storefront.orgLogoUrl }] } : {}),
    },
  };
}

export default async function StorefrontLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // includeUnpublished: auth pages (sign-in, sign-up) must work even before
  // the storefront is published. Content pages enforce isPublished themselves.
  const [storefront, hours] = await Promise.all([
    getPublicStorefront(slug, { includeUnpublished: true }),
    getPublicOperatingHours(),
  ]);
  if (!storefront) notFound();

  const brandingCss = buildBrandingStyleTag(storefront.brandingTokens ?? null);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--dpf-bg)",
        color: "var(--dpf-text)",
        overflowX: "hidden",
      }}
    >
      {brandingCss && <style dangerouslySetInnerHTML={{ __html: brandingCss }} />}
      <StorefrontNav
        orgName={storefront.orgName}
        orgLogoUrl={storefront.orgLogoUrl}
        orgSlug={slug}
      />
      <main style={{ flex: 1, width: "100%", maxWidth: 1200, margin: "0 auto", padding: "0 clamp(16px, 4vw, 24px) 48px", boxSizing: "border-box" }}>
        {children}
      </main>
      <StorefrontTrustFooter storefront={storefront} hours={hours} />
    </div>
  );
}
