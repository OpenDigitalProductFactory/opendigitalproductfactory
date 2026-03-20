import { prisma } from "@dpf/db";
import { redirect } from "next/navigation";
import { StorefrontDashboard } from "@/components/storefront-admin/StorefrontDashboard";

export default async function StorefrontDashboardPage() {
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

  if (!config) redirect("/storefront/setup");

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
