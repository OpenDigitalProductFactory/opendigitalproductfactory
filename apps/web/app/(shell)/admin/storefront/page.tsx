import { prisma } from "@dpf/db";
import { redirect } from "next/navigation";
import { StorefrontDashboard } from "@/components/storefront-admin/StorefrontDashboard";
import { getVocabulary } from "@/lib/storefront/archetype-vocabulary";
import Link from "next/link";

function getSetupSteps(portalLabel: string, stakeholderLabel: string) {
  return [
    {
      num: 1,
      title: "Choose your portal template",
      desc: `Pick an archetype that matches your business. This pre-loads relevant sections and items for your ${portalLabel.toLowerCase()}.`,
    },
    {
      num: 2,
      title: "Preview and configure",
      desc: `Review the template sections and set your URL slug, tagline, and hero image.`,
    },
    {
      num: 3,
      title: "Customise sections and items",
      desc: "Edit the pre-loaded content to match your offering. Add your own sections, products, or services.",
    },
    {
      num: 4,
      title: "Configure settings",
      desc: "Set contact details, branding, and payment or booking options.",
    },
    {
      num: 5,
      title: "Publish",
      desc: `When you're ready, publish your ${portalLabel.toLowerCase()} so ${stakeholderLabel.toLowerCase()} can find it.`,
    },
  ];
}

export default async function StorefrontAdminPage() {
  const config = await prisma.storefrontConfig.findFirst({
    select: {
      id: true,
      isPublished: true,
      tagline: true,
      organization: { select: { slug: true, name: true } },
      archetype: { select: { archetypeId: true, ctaType: true } },
      _count: { select: { sections: true, items: true } },
    },
  });

  if (config) {
    const [inquiryCount, bookingCount, orderCount, donationCount] = await Promise.all([
      prisma.storefrontInquiry.count({ where: { storefrontId: config.id } }),
      prisma.storefrontBooking.count({ where: { storefrontId: config.id } }),
      prisma.storefrontOrder.count({ where: { storefrontId: config.id } }),
      prisma.storefrontDonation.count({ where: { storefrontId: config.id } }),
    ]);
    return (
      <StorefrontDashboard
        config={{
          id: config.id,
          isPublished: config.isPublished,
          tagline: config.tagline,
          orgSlug: config.organization.slug,
          orgName: config.organization.name,
          archetypeId: config.archetype?.archetypeId ?? "",
          ctaType: config.archetype?.ctaType ?? "inquiry",
          sectionCount: config._count.sections,
          itemCount: config._count.items,
        }}
        counts={{ inquiries: inquiryCount, bookings: bookingCount, orders: orderCount, donations: donationCount }}
      />
    );
  }

  // Not yet configured — show step-by-step guide
  // Read BusinessContext to determine vocabulary
  const bc = await prisma.businessContext.findFirst({
    select: { industry: true },
  });
  const vocab = getVocabulary(bc?.industry);

  const SETUP_STEPS = getSetupSteps(vocab.portalLabel, vocab.stakeholderLabel);

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{
        background: "var(--dpf-surface-1, #1a1a2e)",
        border: "1px solid var(--dpf-border, #2a2a40)",
        borderRadius: 10,
        padding: "28px 32px",
        marginBottom: 24,
      }}>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
          Set up your {vocab.portalLabel}
        </div>
        <p style={{ fontSize: 14, color: "var(--dpf-muted, #8888a0)", lineHeight: 1.6, marginBottom: 24 }}>
          Your {vocab.portalLabel.toLowerCase()} lets {vocab.stakeholderLabel.toLowerCase()} browse your offerings, interact with your business, and access services online.
          Follow these steps to get up and running.
        </p>

        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          {SETUP_STEPS.map((step) => (
            <li key={step.num} style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              <div style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "var(--dpf-accent, #4f46e5)",
                color: "var(--dpf-text)",
                fontWeight: 700,
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                marginTop: 1,
              }}>
                {step.num}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 3 }}>{step.title}</div>
                <div style={{ fontSize: 13, color: "var(--dpf-muted, #8888a0)", lineHeight: 1.5 }}>{step.desc}</div>
              </div>
            </li>
          ))}
        </ol>

        <div style={{ marginTop: 28 }}>
          <Link
            href="/admin/storefront/setup"
            style={{
              display: "inline-block",
              padding: "10px 24px",
              background: "var(--dpf-accent, #4f46e5)",
              color: "var(--dpf-text)",
              borderRadius: 7,
              fontSize: 14,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Get started →
          </Link>
        </div>
      </div>
    </div>
  );
}
