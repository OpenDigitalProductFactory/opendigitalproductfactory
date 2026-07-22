import { SignInForm } from "@/components/storefront/SignInForm";
import { getPublicStorefront } from "@/lib/storefront-data";

export default async function StorefrontSignInPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // getPublicStorefront is React-cached, so this reuses the layout's fetch.
  const storefront = await getPublicStorefront(slug, { includeUnpublished: true });
  const orgName = storefront?.orgName;
  return (
    <div style={{ paddingTop: 60, width: "100%", maxWidth: 400, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24, overflowWrap: "break-word" }}>
        {orgName ? `Sign in to ${orgName}` : "Sign in"}
      </h1>
      <SignInForm orgSlug={slug} />
    </div>
  );
}
