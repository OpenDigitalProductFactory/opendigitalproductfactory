import { readFileSync } from "fs";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FacebookPagesConnectPanel } from "./FacebookPagesConnectPanel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

describe("FacebookPagesConnectPanel", () => {
  it("renders the connection form with saved page context", () => {
    const html = renderToStaticMarkup(
      <FacebookPagesConnectPanel
        initialState={{
          status: "connected",
          pageId: "123456789",
          pageName: "Acme Local Page",
          lastErrorMsg: null,
          lastTestedAt: "2026-04-30T11:00:00.000Z",
        }}
      />,
    );

    expect(html).toContain("Facebook Pages");
    expect(html).toContain("Acme Local Page");
    expect(html).toContain("Page Access Token");
    expect(html).toContain("Page ID");
  });

  it("uses semantic DPF theme variables instead of hardcoded status colors", () => {
    const source = readFileSync(
      new URL("./FacebookPagesConnectPanel.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("var(--dpf-success)");
    expect(source).toContain("var(--dpf-error)");
    expect(source).not.toMatch(/text-(red|emerald)-\d+/);
    expect(source).not.toMatch(/bg-(red|emerald)-\d+/);
    expect(source).not.toMatch(/border-(red|emerald)-\d+/);
  });
});
