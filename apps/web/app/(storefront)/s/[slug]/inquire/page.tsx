import { notFound } from "next/navigation";
import { getPublicStorefront } from "@/lib/storefront-data";
import { InquiryForm } from "@/components/storefront/InquiryForm";

const DEFAULT_INQUIRY_SCHEMA = [
  { name: "name", label: "Your name", type: "text", required: true },
  { name: "email", label: "Email address", type: "email", required: true },
  { name: "phone", label: "Phone number (optional)", type: "tel", required: false },
  { name: "message", label: "Message", type: "textarea", required: false },
];

export default async function InquirePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const storefront = await getPublicStorefront(slug);
  if (!storefront) notFound();

  return (
    <div style={{ paddingTop: 40, maxWidth: 520 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Get in Touch</h1>
      <InquiryForm orgSlug={slug} formSchema={DEFAULT_INQUIRY_SCHEMA} />
    </div>
  );
}
