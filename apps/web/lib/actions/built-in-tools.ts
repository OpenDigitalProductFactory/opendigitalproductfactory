"use server";

import { prisma } from "@dpf/db";
import { describeAddressValidationSetup } from "@/lib/shared/address-validation-provider-guidance";
import type { AddressValidationSetupStatus } from "@/lib/shared/address-validation-provider-guidance";

export type BuiltInToolEntry = {
  id: "brave-search" | "public-web-fetch" | "branding-analyzer";
  name: string;
  description: string;
  model: "built-in";
  configKey: string | null;
  configured: boolean;
  capability: string;
};

type KeyState = {
  configured: boolean;
  currentValue: string | null;
};

export async function getBuiltInToolsOverview(): Promise<{
  tools: BuiltInToolEntry[];
  keyData: Record<string, KeyState>;
  addressValidation: AddressValidationSetupStatus & {
    primaryCountry: string | null;
  };
}> {
  const [configs, geocodingService, organization] = await Promise.all([
    prisma.platformConfig.findMany({
      where: { key: { in: ["brave_search_api_key"] } },
      select: { key: true, value: true },
    }),
    prisma.modelProvider.findFirst({
      where: {
        endpointType: "service",
        status: "active",
        OR: [
          { name: { contains: "geocod", mode: "insensitive" } },
          { name: { contains: "places", mode: "insensitive" } },
          { name: { contains: "mapbox", mode: "insensitive" } },
          { name: { contains: "smarty", mode: "insensitive" } },
        ],
      },
      select: { id: true },
    }),
    prisma.organization.findFirst({
      select: { address: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const braveValue =
    configs.find((config) => config.key === "brave_search_api_key")?.value ?? null;
  const braveSearchConfigured =
    typeof braveValue === "string" && braveValue.trim().length > 0;

  // Site lookup remains a separate wiring step (resolveValidatedSiteAddress).
  // A registered geocode service is necessary but not sufficient — report that honestly.
  const commercialProviderDetected = Boolean(geocodingService);
  const siteLookupReady = false;
  const addressStatus = describeAddressValidationSetup({
    commercialProviderDetected,
    siteLookupReady,
  });

  let primaryCountry: string | null = null;
  if (organization?.address && typeof organization.address === "object" && !Array.isArray(organization.address)) {
    const addr = organization.address as Record<string, unknown>;
    const country = addr.country ?? addr.countryCode;
    if (typeof country === "string" && country.trim()) primaryCountry = country.trim();
  }

  return {
    tools: [
      {
        id: "brave-search",
        name: "Brave Search",
        description: "Public web search for coworkers and workflows when external access is enabled.",
        model: "built-in",
        configKey: "brave_search_api_key",
        configured: braveSearchConfigured,
        capability: "search_public_web",
      },
      {
        id: "public-web-fetch",
        name: "Public Web Fetch",
        description: "Fetches public websites for visible metadata and evidence without requiring a separate connector.",
        model: "built-in",
        configKey: null,
        configured: true,
        capability: "fetch_public_website",
      },
      {
        id: "branding-analyzer",
        name: "Branding Analyzer",
        description: "Analyzes public websites to derive company name, logo, and accent-color suggestions.",
        model: "built-in",
        configKey: null,
        configured: true,
        capability: "analyze_public_website_branding",
      },
    ],
    keyData: {
      brave_search_api_key: {
        configured: braveSearchConfigured,
        currentValue: typeof braveValue === "string" && braveValue.length > 0 ? braveValue : null,
      },
    },
    addressValidation: {
      ...addressStatus,
      primaryCountry,
    },
  };
}
