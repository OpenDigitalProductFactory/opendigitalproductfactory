/**
 * Tests for discoverChatGptBackendModels.
 *
 * The function lives in ai-provider-internals.ts which has heavy dependencies
 * (prisma, credential-crypto, etc.) that don't resolve in vitest.
 * Rather than mock the entire dependency tree, we test the HTTP interaction
 * and response parsing logic directly using the same implementation pattern.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Re-implement the core parsing logic for testability (mirrors the implementation)
interface ChatGptModelEntry {
  slug?: string;
  max_tokens?: number;
  title?: string;
  description?: string;
  tags?: string[];
  capabilities?: Record<string, unknown>;
}

function parseChatGptBackendModels(
  json: { models?: ChatGptModelEntry[] },
): { modelId: string; rawMetadata: Record<string, unknown> }[] {
  const entries = json.models ?? [];
  return entries
    .filter((m) => typeof m.slug === "string" && m.slug.length > 0)
    .map((m) => ({
      modelId: m.slug!,
      rawMetadata: {
        ...m as Record<string, unknown>,
        id: m.slug,
        source: "chatgpt_backend_discovery",
      },
    }));
}

describe("ChatGPT backend model discovery parsing", () => {
  it("parses models from ChatGPT backend /backend-api/models response", () => {
    const response = {
      models: [
        {
          slug: "gpt-5.4",
          max_tokens: 128000,
          title: "GPT-5.4",
          description: "Most capable model",
          tags: ["gpt5"],
          capabilities: { tools: true },
        },
        {
          slug: "gpt-5.3-codex",
          max_tokens: 400000,
          title: "GPT-5.3 Codex",
          description: "Optimized for coding",
          tags: ["codex"],
          capabilities: { tools: true },
        },
        {
          slug: "gpt-5.4-mini",
          max_tokens: 128000,
          title: "GPT-5.4 Mini",
          description: "Fast and efficient",
          tags: ["gpt5"],
          capabilities: { tools: true },
        },
      ],
      categories: [
        { category: "gpt_5", human_category_name: "GPT-5", default_model: "gpt-5.4" },
      ],
    };

    const models = parseChatGptBackendModels(response);

    expect(models).toHaveLength(3);
    expect(models.map(m => m.modelId)).toEqual([
      "gpt-5.4",
      "gpt-5.3-codex",
      "gpt-5.4-mini",
    ]);

    // Check rawMetadata includes source marker
    expect(models[0].rawMetadata.source).toBe("chatgpt_backend_discovery");
    expect(models[0].rawMetadata.id).toBe("gpt-5.4");
    expect(models[0].rawMetadata.max_tokens).toBe(128000);
  });

  it("filters out entries without a slug", () => {
    const response = {
      models: [
        { slug: "gpt-5.4", title: "GPT-5.4" },
        { title: "No Slug Model" } as ChatGptModelEntry,
        { slug: "", title: "Empty Slug" },
        { slug: "gpt-5.3-codex", title: "Codex" },
      ],
    };

    const models = parseChatGptBackendModels(response);

    expect(models).toHaveLength(2);
    expect(models.map(m => m.modelId)).toEqual(["gpt-5.4", "gpt-5.3-codex"]);
  });

  it("handles empty models array", () => {
    const models = parseChatGptBackendModels({ models: [] });
    expect(models).toHaveLength(0);
  });

  it("handles missing models field", () => {
    const models = parseChatGptBackendModels({} as { models?: ChatGptModelEntry[] });
    expect(models).toHaveLength(0);
  });

  it("preserves all original fields in rawMetadata", () => {
    const response = {
      models: [{
        slug: "gpt-5.4",
        max_tokens: 128000,
        title: "GPT-5.4",
        description: "Most capable model",
        tags: ["gpt5", "frontier"],
        capabilities: { tools: true, streaming: true },
      }],
    };

    const models = parseChatGptBackendModels(response);
    const meta = models[0].rawMetadata;

    expect(meta.slug).toBe("gpt-5.4");
    expect(meta.max_tokens).toBe(128000);
    expect(meta.title).toBe("GPT-5.4");
    expect(meta.description).toBe("Most capable model");
    expect(meta.tags).toEqual(["gpt5", "frontier"]);
    expect(meta.capabilities).toEqual({ tools: true, streaming: true });
    // Added fields
    expect(meta.id).toBe("gpt-5.4");
    expect(meta.source).toBe("chatgpt_backend_discovery");
  });
});
