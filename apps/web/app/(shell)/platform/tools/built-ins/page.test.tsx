import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/built-in-tools", () => ({
  getBuiltInToolsOverview: vi.fn().mockResolvedValue({
    tools: [
      {
        id: "brave-search",
        name: "Brave Search",
        description: "Public web search",
        model: "built-in",
        configKey: "brave_search_api_key",
        configured: true,
        capability: "search_public_web",
      },
    ],
    keyData: {
      brave_search_api_key: {
        configured: true,
        currentValue: "BSA-secret",
      },
    },
  }),
}));

vi.mock("@/components/admin/PlatformKeysPanel", () => ({
  PLATFORM_KEY_CONFIGS: [
    {
      key: "brave_search_api_key",
      label: "Brave Search API Key",
      description: "desc",
      placeholder: "BSA-xxx",
      isSecret: true,
    },
  ],
  PlatformKeysPanel: () => <div>platform-keys-panel</div>,
}));

describe("BuiltInToolsPage", () => {
  it("renders built-in tools and the Brave Search configuration panel", async () => {
    const { default: BuiltInToolsPage } = await import("./page");
    const html = renderToStaticMarkup(await BuiltInToolsPage());

    expect(html).toContain("Built-in Tools");
    expect(html).toContain("Brave Search");
    expect(html).toContain("search_public_web");
    expect(html).toContain("platform-keys-panel");
  });
});
