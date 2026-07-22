import { notFound } from "next/navigation";
import { prisma } from "@dpf/db";
import { resolveInquiryFormSchema } from "@/lib/storefront-data";
import { InquiryReceived, type SubmittedDetail } from "@/components/storefront/InquiryReceived";

// Fields shown in dedicated rows / used as the message body — excluded from the
// generic archetype-field list so they are not duplicated in "What you sent us".
const RESERVED_FIELDS = new Set(["name", "email", "phone", "notes", "message"]);

export default async function InquiryReceivedPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ref?: string }>;
}) {
  const { slug } = await params;
  const { ref } = await searchParams;
  if (!ref) notFound();

  const config = await prisma.storefrontConfig.findFirst({
    where: { organization: { slug } },
    select: {
      id: true,
      contactEmail: true,
      contactPhone: true,
      archetype: { select: { archetypeId: true } },
      organization: { select: { name: true } },
    },
  });
  if (!config) notFound();

  const inquiry = await prisma.storefrontInquiry.findFirst({
    where: { inquiryRef: ref, storefrontId: config.id },
    select: {
      inquiryRef: true,
      customerName: true,
      customerEmail: true,
      customerPhone: true,
      message: true,
      itemId: true,
      formData: true,
    },
  });
  if (!inquiry) notFound();

  const details: SubmittedDetail[] = [];

  // What the enquiry was about, when tied to a specific offer/item.
  if (inquiry.itemId) {
    const item = await prisma.storefrontItem.findFirst({
      where: { itemId: inquiry.itemId, storefrontId: config.id },
      select: { name: true },
    });
    if (item?.name) details.push({ label: "About", value: item.name });
  }

  if (inquiry.customerPhone?.trim()) {
    details.push({ label: "Phone", value: inquiry.customerPhone.trim() });
  }

  // Archetype-specific fields (party size, preferred date, etc.) mapped through
  // the schema so a customer sees the label they filled in, not the raw key.
  const formData = (inquiry.formData ?? {}) as Record<string, unknown>;
  const schemaKeys = Object.keys(formData).filter(
    (k) => !RESERVED_FIELDS.has(k) && k !== "calculatorSnapshot",
  );
  if (schemaKeys.length > 0) {
    const schema = await resolveInquiryFormSchema(config.archetype?.archetypeId ?? "");
    const labelFor = new Map(schema.map((f) => [f.name, f.label]));
    for (const key of schemaKeys) {
      const raw = formData[key];
      if (raw == null || raw === "") continue;
      const value = Array.isArray(raw) ? raw.join(", ") : String(raw);
      details.push({ label: labelFor.get(key) ?? key, value });
    }
  }

  if (inquiry.message?.trim()) {
    details.push({ label: "Message", value: inquiry.message.trim() });
  }

  return (
    <InquiryReceived
      orgName={config.organization.name}
      orgSlug={slug}
      reference={inquiry.inquiryRef}
      customerName={inquiry.customerName}
      customerEmail={inquiry.customerEmail}
      details={details}
      contactEmail={config.contactEmail}
      contactPhone={config.contactPhone}
    />
  );
}
