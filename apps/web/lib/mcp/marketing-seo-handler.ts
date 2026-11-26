import { findInstallOrganization, prisma } from "@dpf/db";
import type { ToolResult } from "@/lib/mcp-tool-types";

export async function analyzeSeoOpportunityHandler(): Promise<ToolResult> {
  const { resolveMarketingArchetypeContext, MARKETING_NO_STOREFRONT_MESSAGE } = await import(
    "@/lib/marketing/archetype-context"
  );

  const context = await resolveMarketingArchetypeContext({
    includeItems: true,
    includeSections: true,
    itemLimit: 20,
  });
  if (!context) {
    return { success: true, message: MARKETING_NO_STOREFRONT_MESSAGE };
  }

  const config = {
    id: context.storefrontId,
    archetype: context.archetype,
    items: context.items,
    sections: context.sections,
  };
  const playbook = context.playbook;

  // Never take a location from a different organization than the storefront.
  const org = await findInstallOrganization(prisma, { id: true, address: true });
  const address = (org?.id === context.organizationId ? org.address : null) as Record<string, string> | null;
  const location = address?.city
    ? `${address.city}${address.region ? `, ${address.region}` : ""}${address.country ? `, ${address.country}` : ""}`
    : null;

  // Build suggested search intents from services + location
  const serviceNames = config.items.map((i) => i.name);
  const locationSuffix = location ? ` ${address?.city}` : " near me";
  const suggestedSearchIntents = serviceNames.slice(0, 5).map((name) => `${name.toLowerCase()}${locationSuffix}`);

  // Add generic archetype-based intents
  if (config.archetype.category === "healthcare-wellness") {
    suggestedSearchIntents.push(`${config.archetype.name.toLowerCase()} accepting patients${locationSuffix}`);
  } else if (config.archetype.category === "trades-maintenance") {
    suggestedSearchIntents.push(`emergency ${config.archetype.name.toLowerCase()}${locationSuffix}`);
  } else if (config.archetype.category === "food-hospitality") {
    suggestedSearchIntents.push(`best ${config.archetype.name.toLowerCase()}${locationSuffix}`);
  }

  return {
    success: true,
    message: `SEO context for ${config.archetype.name}`,
    data: {
      businessType: config.archetype.name,
      archetype: {
        category: config.archetype.category,
        name: config.archetype.name,
      },
      location,
      services: serviceNames,
      existingContent: config.sections.map((s) => s.title || s.type),
      playbook: {
        primaryGoal: playbook.primaryGoal,
        campaignTypes: playbook.campaignTypes,
      },
      suggestedSearchIntents,
    },
  };
}
