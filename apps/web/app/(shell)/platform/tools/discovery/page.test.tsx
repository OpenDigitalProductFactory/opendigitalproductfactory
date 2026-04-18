import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/inventory/DiscoveryOperationsPage", () => ({
  DiscoveryOperationsPage: ({ isLegacyAlias = false }: { isLegacyAlias?: boolean }) => (
    <div data-page="discovery-operations" data-legacy-alias={String(isLegacyAlias)} />
  ),
}));

describe("PlatformDiscoveryOperationsPage", () => {
  it("renders the canonical discovery operations page without alias mode", async () => {
    const { default: PlatformDiscoveryOperationsPage } = await import("./page");
    const html = renderToStaticMarkup(await PlatformDiscoveryOperationsPage());

    expect(html).toContain('data-page="discovery-operations"');
    expect(html).toContain('data-legacy-alias="false"');
  });
});
