import { notFound } from "next/navigation";
import { getPublicStorefront } from "@/lib/storefront-data";
import { buildBrandingStyleTag } from "@/lib/branding";
import { StorefrontNav } from "@/components/storefront/StorefrontNav";

export default async function StorefrontLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const storefront = await getPublicStorefront(slug);
  if (!storefront) notFound();

  const brandingCss = buildBrandingStyleTag(storefront.brandingTokens ?? null);

  return (
    <div style={{ minHeight: "100vh", background: "#ffffff", color: "#111827" }}>
      {brandingCss && <style dangerouslySetInnerHTML={{ __html: brandingCss }} />}
      <StorefrontNav
        orgName={storefront.orgName}
        orgLogoUrl={storefront.orgLogoUrl}
        orgSlug={slug}
      />
      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px 48px" }}>
        {children}
      </main>
    </div>
  );
}
