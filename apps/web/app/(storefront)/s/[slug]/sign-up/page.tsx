import { SignUpForm } from "@/components/storefront/SignUpForm";
import { getPublicStorefront } from "@/lib/storefront-data";

export default async function StorefrontSignUpPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ email?: string }>;
}) {
  const { slug } = await params;
  const { email: prefillEmail } = await searchParams;
  // getPublicStorefront is React-cached, so this reuses the layout's fetch.
  const storefront = await getPublicStorefront(slug, { includeUnpublished: true });
  const orgName = storefront?.orgName;
  return (
    <div style={{ paddingTop: 60, width: "100%", maxWidth: 400, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24, overflowWrap: "break-word" }}>
        {orgName ? `Create your ${orgName} account` : "Create an account"}
      </h1>
      <SignUpForm orgSlug={slug} {...(prefillEmail ? { prefillEmail } : {})} />
    </div>
  );
}
