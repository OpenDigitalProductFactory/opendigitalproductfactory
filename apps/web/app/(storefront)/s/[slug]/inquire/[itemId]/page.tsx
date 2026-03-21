import { notFound } from "next/navigation";
import { getPublicStorefront, getPublicItem } from "@/lib/storefront-data";
import { InquiryForm } from "@/components/storefront/InquiryForm";

const DEFAULT_INQUIRY_SCHEMA = [
  { name: "name", label: "Your name", type: "text", required: true },
  { name: "email", label: "Email address", type: "email", required: true },
  { name: "phone", label: "Phone number (optional)", type: "tel", required: false },
  { name: "message", label: "Message or question", type: "textarea", required: false },
];

export default async function ItemInquirePage({
  params,
}: {
  params: Promise<{ slug: string; itemId: string }>;
}) {
  const { slug, itemId } = await params;
  const [storefront, item] = await Promise.all([
    getPublicStorefront(slug),
    getPublicItem(slug, itemId),
  ]);
  if (!storefront || !item) notFound();

  return (
    <div style={{ paddingTop: 40, maxWidth: 520 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Enquire about {item.name}</h1>
      <p style={{ color: "var(--dpf-muted)", marginBottom: 24, fontSize: 14 }}>{item.description}</p>
      <InquiryForm orgSlug={slug} itemId={itemId} formSchema={DEFAULT_INQUIRY_SCHEMA} />
    </div>
  );
}
