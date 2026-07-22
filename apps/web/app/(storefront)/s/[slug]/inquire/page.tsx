import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublicStorefront, resolveInquiryFormSchema } from "@/lib/storefront-data";
import { InquiryForm } from "@/components/storefront/InquiryForm";

export default async function InquirePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const storefront = await getPublicStorefront(slug);
  if (!storefront) notFound();

  const formSchema = await resolveInquiryFormSchema(storefront.archetypeId);
  const isSoftwarePlatform = storefront.archetypeId === "software-platform";

  return (
    <div style={{ paddingTop: 40, maxWidth: 520 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
        {isSoftwarePlatform ? "Start a DPF conversation" : "Get in Touch"}
      </h1>
      <p style={{ fontSize: 14, color: "var(--dpf-muted)", marginBottom: 24 }}>
        {isSoftwarePlatform
          ? "Tell us about your current product operation, delivery workflow, or customer-zero goals and we will route the conversation through the platform."
          : "Share what you need and we will route your inquiry to the right team."}
      </p>
      <InquiryForm orgSlug={slug} formSchema={formSchema} />
      <p style={{ marginTop: 16, fontSize: 12, color: "var(--dpf-muted)" }}>
        We use your details only to respond to your message. See our{" "}
        <Link href={`/s/${slug}/policies#privacy`} style={{ color: "var(--dpf-accent)" }}>privacy notice</Link>.
      </p>
    </div>
  );
}
