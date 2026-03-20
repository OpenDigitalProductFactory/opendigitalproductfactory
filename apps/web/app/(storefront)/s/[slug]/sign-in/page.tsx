import { SignInForm } from "@/components/storefront/SignInForm";

export default async function StorefrontSignInPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <div style={{ paddingTop: 60, maxWidth: 400, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Sign in</h1>
      <SignInForm orgSlug={slug} />
    </div>
  );
}
