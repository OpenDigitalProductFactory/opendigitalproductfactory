// apps/web/lib/tak/route-context/providers/commerce.ts
// Commerce page-context providers (portfolio, storefront, funnel).
// Extracted verbatim from route-context.ts (page-owned context contract,
// design spec 2026-08-05 Phase 2 PR 2). Behavior unchanged.

import { prisma } from "@dpf/db";
import { getPlaybook } from "@/lib/tak/marketing-playbooks";
import { getVocabulary } from "@/lib/storefront/archetype-vocabulary";
import {
  isManagedServiceProviderProfile,
  readActivationProfile,
} from "@/lib/storefront/archetype-activation";

export async function getPortfolioContext(): Promise<string> {
  const [portfolioCount, productCount, nodeCount] = await Promise.all([
    prisma.portfolio.count(),
    prisma.digitalProduct.count(),
    prisma.taxonomyNode.count(),
  ]);

  const portfolios = await prisma.portfolio.findMany({
    orderBy: { name: "asc" },
    select: { name: true, _count: { select: { products: true } } },
  });

  return [
    "\nPAGE DATA — Portfolio:",
    `${portfolioCount} portfolios, ${productCount} products, ${nodeCount} taxonomy nodes`,
    "",
    ...portfolios.map((p) => `- ${p.name}: ${p._count.products} products`),
  ].join("\n");
}
export async function getStorefrontMarketingContext(): Promise<string> {
  const config = await prisma.storefrontConfig.findFirst({
    include: {
      archetype: {
        select: {
          archetypeId: true,
          name: true,
          category: true,
          ctaType: true,
          customVocabulary: true,
          activationProfile: true,
        },
      },
    },
  });

  if (!config) {
    return "\nPAGE DATA — Portal:\nNo portal configured yet. Set up your portal at /storefront/setup to unlock business-model-specific recommendations.";
  }

  const archetype = config.archetype;
  const playbook = getPlaybook(archetype.category, archetype.ctaType);
  const vocabulary = getVocabulary(archetype.category, archetype.customVocabulary as Record<string, string> | null);
  const activationProfile = readActivationProfile(archetype.activationProfile);

  // Inbox metrics — last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [bookingCount, inquiryCount, orderCount, donationCount] = await Promise.all([
    prisma.storefrontBooking.count({
      where: { storefrontId: config.id, createdAt: { gte: thirtyDaysAgo } },
    }),
    prisma.storefrontInquiry.count({
      where: { storefrontId: config.id, createdAt: { gte: thirtyDaysAgo } },
    }),
    prisma.storefrontOrder.count({
      where: { storefrontId: config.id, createdAt: { gte: thirtyDaysAgo } },
    }),
    prisma.storefrontDonation.count({
      where: { storefrontId: config.id, createdAt: { gte: thirtyDaysAgo } },
    }),
  ]);

  // CRM pipeline summary
  const [engagementsByStatus, opportunitiesByStage] = await Promise.all([
    prisma.engagement.groupBy({ by: ["status"], _count: true }),
    prisma.opportunity.groupBy({ by: ["stage"], _count: true }),
  ]);

  const engagementSummary = engagementsByStatus
    .map((e) => `${e.status}: ${e._count}`)
    .join(", ");
  const opportunitySummary = opportunitiesByStage
    .map((o) => `${o.stage}: ${o._count}`)
    .join(", ");

  const totalInbox = bookingCount + inquiryCount + orderCount + donationCount;
  const activationLines = isManagedServiceProviderProfile(activationProfile)
    ? [
        "",
        "OPERATING PROFILE:",
        `Archetype activation: ${activationProfile.profileType}`,
        `Operating modules: ${activationProfile.modules.join(", ")}`,
        `Billing mode: ${activationProfile.billingReadinessMode}`,
        `Customer graph: ${activationProfile.customerGraph}`,
        `Estate separation: ${activationProfile.estateSeparation}`,
      ]
    : [];

  return [
    `\nPAGE DATA — ${vocabulary.portalLabel}:`,
    `Business type: ${archetype.name} (${archetype.category})`,
    `Portal label: ${vocabulary.portalLabel}`,
    `Stakeholders: ${vocabulary.stakeholderLabel}`,
    `Agent role: ${vocabulary.agentName}`,
    `CTA type: ${archetype.ctaType}`,
    "",
    "MARKETING PLAYBOOK (adapted to this business model):",
    `Primary goal: ${playbook.primaryGoal}`,
    `Key stakeholders: ${playbook.stakeholders}`,
    `Recommended campaign types: ${playbook.campaignTypes.join("; ")}`,
    `Content tone: ${playbook.contentTone}`,
    `Key metrics to track: ${playbook.keyMetrics.join("; ")}`,
    `CTA language: ${playbook.ctaLanguage.join(", ")}`,
    `Agent skills for this model: ${playbook.agentSkills.join(", ")}`,
    ...activationLines,
    "",
    `INBOX (last 30 days): ${totalInbox} total — Bookings: ${bookingCount}, Inquiries: ${inquiryCount}, Orders: ${orderCount}, Donations: ${donationCount}`,
    "",
    `CRM PIPELINE:`,
    `Engagements: ${engagementSummary || "none"}`,
    `Opportunities: ${opportunitySummary || "none"}`,
  ].join("\n");
}
export async function getCustomerFunnelContext(): Promise<string> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Load archetype for CTA-aware funnel labelling
  const config = await prisma.storefrontConfig.findFirst({
    include: {
      archetype: { select: { name: true, ctaType: true } },
    },
  });

  // Storefront interaction counts (top of funnel)
  const [bookings, inquiries, orders, donations] = await Promise.all([
    prisma.storefrontBooking.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.storefrontInquiry.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.storefrontOrder.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.storefrontDonation.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
  ]);

  // CRM pipeline stages
  const [engagements, opportunities] = await Promise.all([
    prisma.engagement.groupBy({ by: ["status"], _count: true }),
    prisma.opportunity.groupBy({ by: ["stage"], _count: true }),
  ]);

  const totalInteractions = bookings + inquiries + orders + donations;
  const totalEngagements = engagements.reduce((sum, e) => sum + e._count, 0);
  const totalOpportunities = opportunities.reduce((sum, o) => sum + o._count, 0);
  const closedWon = opportunities.find((o) => o.stage === "closed_won")?._count ?? 0;
  const closedLost = opportunities.find((o) => o.stage === "closed_lost")?._count ?? 0;

  const convEngagement = totalInteractions > 0
    ? ((totalEngagements / totalInteractions) * 100).toFixed(0)
    : "N/A";
  const convOpportunity = totalEngagements > 0
    ? ((totalOpportunities / totalEngagements) * 100).toFixed(0)
    : "N/A";
  const convWon = totalOpportunities > 0
    ? ((closedWon / totalOpportunities) * 100).toFixed(0)
    : "N/A";

  const ctaType = config?.archetype?.ctaType ?? "inquiry";
  const businessLabel = config?.archetype?.name ?? "Unknown business type";

  return [
    "\nPAGE DATA — Conversion Funnel (last 30 days):",
    `Business type: ${businessLabel} (CTA: ${ctaType})`,
    "",
    "FUNNEL STAGES:",
    `1. Storefront interactions: ${totalInteractions} (Bookings: ${bookings}, Inquiries: ${inquiries}, Orders: ${orders}, Donations: ${donations})`,
    `2. Engagements: ${totalEngagements} (conversion: ${convEngagement}%)`,
    `   ${engagements.map((e) => `${e.status}: ${e._count}`).join(", ") || "none"}`,
    `3. Opportunities: ${totalOpportunities} (conversion: ${convOpportunity}%)`,
    `   ${opportunities.map((o) => `${o.stage}: ${o._count}`).join(", ") || "none"}`,
    `4. Closed won: ${closedWon} (win rate: ${convWon}%), Closed lost: ${closedLost}`,
  ].join("\n");
}
