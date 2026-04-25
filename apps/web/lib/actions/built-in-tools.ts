"use server";

import { prisma } from "@dpf/db";

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
}> {
  const configs = await prisma.platformConfig.findMany({
    where: { key: { in: ["brave_search_api_key"] } },
    select: { key: true, value: true },
  });

  const braveValue =
    configs.find((config) => config.key === "brave_search_api_key")?.value ?? null;
  const braveSearchConfigured =
    typeof braveValue === "string" && braveValue.trim().length > 0;

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
  };
}
