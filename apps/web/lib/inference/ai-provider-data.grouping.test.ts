import { describe, expect, it, vi } from "vitest";

vi.mock("react", () => ({
  cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

vi.mock("@dpf/db", () => ({
  prisma: {},
}));

import { groupByEndpointTypeAndCategory } from "./ai-provider-data";
import type { ProviderWithCredential } from "./ai-provider-types";
import registry from "../../../../packages/db/data/providers-registry.json";

it("keeps the ChatGPT routing provider visible in the canonical registry", () => {
  expect(registry.find(p => p.providerId === "chatgpt")?.catalogVisibility).toBe("visible");
  expect(registry.find(p => p.providerId === "zai-coding")?.catalogVisibility).toBe("visible");
  expect(registry.find(p => p.providerId === "chatgpt")?.consoleUrl).toBe("https://chatgpt.com");
});

function provider(
  providerId: string,
  endpointType: string | null,
  category: string,
): ProviderWithCredential {
  return {
    provider: {
      providerId,
      name: providerId,
      endpointType,
      category,
    },
    credential: null,
  } as ProviderWithCredential;
}

describe("groupByEndpointTypeAndCategory", () => {
  it("uses distinct names for direct providers with different endpoint types", () => {
    const groups = groupByEndpointTypeAndCategory([
      provider("anthropic", null, "direct"),
      provider("chatgpt", "responses", "direct"),
      provider("speaches", "transcription", "direct"),
    ]);

    expect(groups.map((group) => group.displayName)).toEqual([
      "Direct APIs",
      "Subscription responses",
      "Speech transcription",
    ]);
  });
});
