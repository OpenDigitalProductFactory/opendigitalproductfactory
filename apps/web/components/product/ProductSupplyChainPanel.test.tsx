// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductSupplyChainPanel } from "./ProductSupplyChainPanel";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

describe("ProductSupplyChainPanel", () => {
  it("shows an empty state when there is no BOM", () => {
    render(<ProductSupplyChainPanel productId="prod-1" latestBom={null} components={[]} />);

    expect(screen.getByText("Supply Chain")).toBeInTheDocument();
    expect(screen.getByText("No BOM has been generated for this product yet.")).toBeInTheDocument();
  });

  it("renders component rows and export link", () => {
    render(
      <ProductSupplyChainPanel
        productId="prod-1"
        latestBom={{
          documentId: "bom_abc",
          generatedAt: new Date("2026-05-22T00:00:00.000Z"),
          digest: "abcdef1234567890",
          componentCount: 2,
        }}
        components={[
          {
            name: "next",
            version: "16.2.6",
            componentType: "framework",
            ecosystem: "npm",
            packageUrl: "pkg:npm/next@16.2.6",
          },
          {
            name: "gpt-5.4",
            version: "2026-05",
            componentType: "model",
            ecosystem: "ai-model",
            packageUrl: null,
          },
        ]}
      />,
    );

    expect(screen.getByText("next")).toBeInTheDocument();
    expect(screen.getByText("gpt-5.4")).toBeInTheDocument();
    expect(screen.getByText("2 components")).toBeInTheDocument();
    expect(screen.getByText("1 AI model")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Export shareable SBOM/i })).toHaveAttribute(
      "href",
      "/api/portfolio/product/prod-1/supply-chain/bom",
    );
  });
});
