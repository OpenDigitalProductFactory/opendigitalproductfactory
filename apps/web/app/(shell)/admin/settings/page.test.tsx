import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@dpf/db", () => ({
  prisma: {
    platformConfig: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock("@/components/admin/AdminTabNav", () => ({
  AdminTabNav: () => <div>admin-tab-nav</div>,
}));

vi.mock("@/components/admin/SocialAuthPanel", () => ({
  SocialAuthPanel: () => <div>social-auth-panel</div>,
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
    {
      key: "upload_storage_path",
      label: "File Upload Storage Path",
      description: "desc",
      placeholder: "./data/uploads",
      isSecret: false,
    },
  ],
  PlatformKeysPanel: ({ configs }: { configs: Array<{ label: string }> }) => (
    <div>{configs.map((config) => config.label).join(", ")}</div>
  ),
}));

describe("AdminSettingsPage", () => {
  it("limits core configuration to admin-owned settings", async () => {
    const { default: AdminSettingsPage } = await import("./page");
    const html = renderToStaticMarkup(await AdminSettingsPage());

    expect(html).toContain("File Upload Storage Path");
    expect(html).not.toContain("Brave Search API Key");
  });
});
