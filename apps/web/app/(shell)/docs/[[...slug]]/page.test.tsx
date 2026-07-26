import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {},
}));

vi.mock("@/components/docs/DocsLayout", () => ({
  DocsLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

describe("DocsPage", () => {
  it("renders the authored user-guide index as the non-contextual docs home", async () => {
    const { default: DocsPage } = await import("./page");
    const html = renderToStaticMarkup(
      await DocsPage({
        params: Promise.resolve({}),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(html).toContain("User Guide");
    expect(html).toContain("Choose your path");
    expect(html).toContain("/api/docs-asset/assets/diagrams/index/0.svg?v=");
    expect(html).toContain("/docs/architecture/index");
    expect(html).not.toContain("/docs/unknown/index");
    expect(html).not.toContain("Learn how to use every area of the platform.");
  });
});
