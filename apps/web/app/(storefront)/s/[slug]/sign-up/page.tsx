import { SignUpForm } from "@/components/storefront/SignUpForm";

export default async function StorefrontSignUpPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ email?: string }>;
}) {
  const { slug } = await params;
  const { email: prefillEmail } = await searchParams;
  return (
    <div style={{ paddingTop: 60, maxWidth: 400, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Create an account</h1>
      <SignUpForm orgSlug={slug} prefillEmail={prefillEmail} />
    </div>
  );
}
