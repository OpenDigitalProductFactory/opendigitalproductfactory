import { prisma } from "../src/client";

const SERVICE_ENDPOINTS = [
  {
    providerId: "brave-search",
    name: "Brave Search",
    endpointType: "service",
    sensitivityClearance: ["public", "internal"],
    capabilityTier: "basic",
    costBand: "free",
    taskTags: ["web-search"],
    status: "active",
    category: "mcp-internal",
    costModel: "token",
    authMethod: "api_key",
  },
  {
    providerId: "public-fetch",
    name: "Public URL Fetcher",
    endpointType: "service",
    sensitivityClearance: ["public", "internal"],
    capabilityTier: "basic",
    costBand: "free",
    taskTags: ["web-fetch"],
    status: "active",
    category: "mcp-internal",
    costModel: "compute",
    authMethod: "none",
  },
  {
    providerId: "branding-analyzer",
    name: "Branding Analyzer",
    endpointType: "service",
    sensitivityClearance: ["public", "internal"],
    capabilityTier: "basic",
    costBand: "free",
    taskTags: ["branding-analysis", "web-fetch"],
    status: "active",
    category: "mcp-internal",
    costModel: "compute",
    authMethod: "none",
  },
];

async function seed() {
  for (const ep of SERVICE_ENDPOINTS) {
    await prisma.modelProvider.upsert({
      where: { providerId: ep.providerId },
      update: {
        endpointType: ep.endpointType,
        sensitivityClearance: ep.sensitivityClearance,
        capabilityTier: ep.capabilityTier,
        costBand: ep.costBand,
        taskTags: ep.taskTags,
      },
      create: {
        providerId: ep.providerId,
        name: ep.name,
        endpointType: ep.endpointType,
        sensitivityClearance: ep.sensitivityClearance,
        capabilityTier: ep.capabilityTier,
        costBand: ep.costBand,
        taskTags: ep.taskTags,
        status: ep.status,
        category: ep.category,
        costModel: ep.costModel,
        families: [],
        enabledFamilies: [],
        authMethod: ep.authMethod,
        supportedAuthMethods: [ep.authMethod],
      },
    });
    console.log(`Seeded: ${ep.providerId}`);
  }
  // singleton manages its own lifecycle
}

seed().catch(console.error);
