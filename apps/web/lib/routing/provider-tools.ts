// apps/web/lib/routing/provider-tools.ts

/**
 * EP-INF-008b: Derive provider-specific tool declarations from model capabilities
 * and contract family. These are injected into the request body by the chat adapter.
 */

import type { ModelCardCapabilities } from "./model-card-types";
import { isAnthropic } from "./provider-utils";

export function buildProviderTools(
  providerId: string,
  capabilities: ModelCardCapabilities,
  contractFamily: string,
): Array<Record<string, unknown>> {
  const tools: Array<Record<string, unknown>> = [];

  // Gemini code execution for code-gen contracts
  if (
    providerId === "gemini" &&
    capabilities.codeExecution === true &&
    contractFamily === "sync.code-gen"
  ) {
    tools.push({ code_execution: {} });
  }

  // Gemini grounding for web-search contracts
  if (
    providerId === "gemini" &&
    capabilities.webSearch === true &&
    contractFamily === "sync.web-search"
  ) {
    tools.push({
      google_search_retrieval: {
        dynamic_retrieval_config: { mode: "MODE_DYNAMIC" },
      },
    });
  }

  // Anthropic computer use for tool-action contracts
  if (
    isAnthropic(providerId) &&
    capabilities.computerUse === true &&
    contractFamily === "sync.tool-action"
  ) {
    tools.push({
      type: "computer_20241022",
      name: "computer",
      display_width_px: 1024,
      display_height_px: 768,
    });
  }

  return tools;
}
