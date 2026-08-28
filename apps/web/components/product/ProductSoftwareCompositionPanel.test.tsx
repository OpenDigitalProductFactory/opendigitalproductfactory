// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductSoftwareCompositionPanel } from "./ProductSoftwareCompositionPanel";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/actions/assurance", () => ({
  setAssuranceFindingStatus: vi.fn(),
  requestBacklogFromAssuranceFinding: vi.fn(),
}));

afterEach(cleanup);

const emptyFindings = {
  total: 0,
  blocking: 0,
  bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  byKind: {},
};

const noScanner = {
  state: "needs-evaluation" as const,
  approvedScannerCount: 0,
  scannerNames: [],
  reason: "no-approved-scanner" as const,
};

describe("ProductSoftwareCompositionPanel", () => {
  it("shows an empty state when there is no BOM", () => {
    render(
      <ProductSoftwareCompositionPanel
        productId="prod-1"
        latestBom={null}
        components={[]}
        findingSummary={emptyFindings}
        scanner={noScanner}
        platformProduct
      />,
    );

    expect(screen.getByRole("heading", { name: "Software composition" })).toBeInTheDocument();
    expect(screen.getByText("No BOM has been generated for this product yet.")).toBeInTheDocument();
    expect(screen.getByText(/platform SBOM seed ingestion has not completed/i)).toBeInTheDocument();
    expect(screen.getByText("No approved vulnerability scanner")).toBeInTheDocument();
  });

  it("renders component rows and export link", () => {
    render(
      <ProductSoftwareCompositionPanel
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
            lifecycleMilestones: [
              {
                milestone: "security_updates_end",
                date: new Date("2026-07-01T00:00:00.000Z"),
                confidence: 0.95,
              },
            ],
          },
          {
            name: "gpt-5.4",
            version: "2026-05",
            componentType: "model",
            ecosystem: "ai-model",
            packageUrl: null,
            lifecycleMilestones: [],
          },
        ]}
        findingSummary={emptyFindings}
        scanner={noScanner}
      />,
    );

    expect(screen.getByText("next")).toBeInTheDocument();
    expect(screen.getByText("gpt-5.4")).toBeInTheDocument();
    expect(screen.getByText("2 components")).toBeInTheDocument();
    expect(screen.getByText("1 AI model")).toBeInTheDocument();
    expect(screen.getByText("0 active")).toBeInTheDocument();
    expect(screen.getByText("End of life")).toBeInTheDocument();
    expect(screen.getAllByText("Not sourced")).toHaveLength(2);
    expect(screen.getByText("Jul 1, 2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Export full SBOM/i })).toHaveAttribute(
      "href",
      "/api/portfolio/product/prod-1/supply-chain/bom",
    );
  });

  it("surfaces blocking finding posture without hiding the SBOM", () => {
    render(
      <ProductSoftwareCompositionPanel
        productId="prod-1"
        latestBom={{
          documentId: "bom_abc",
          generatedAt: new Date("2026-05-22T00:00:00.000Z"),
          digest: "abcdef1234567890",
          componentCount: 1,
        }}
        components={[
          {
            name: "next",
            version: "16.2.6",
            componentType: "framework",
            ecosystem: "npm",
            packageUrl: "pkg:npm/next@16.2.6",
            lifecycleMilestones: [],
          },
        ]}
        findingSummary={{
          ...emptyFindings,
          total: 2,
          blocking: 1,
          bySeverity: { critical: 1, high: 0, medium: 1, low: 0, info: 0 },
          byKind: { vulnerability: 2 },
        }}
        scanner={{
          state: "ready",
          approvedScannerCount: 1,
          scannerNames: ["Example Scanner"],
          reason: "approved-scanner-available",
        }}
      />,
    );

    expect(screen.getByText("2 active")).toBeInTheDocument();
    expect(screen.getByText("1 blocking")).toBeInTheDocument();
    expect(screen.getByText("Example Scanner")).toBeInTheDocument();
  });

  it("renders the active findings section in read-only mode", () => {
    render(
      <ProductSoftwareCompositionPanel
        productId="prod-1"
        latestBom={{
          documentId: "bom_abc",
          generatedAt: new Date("2026-05-22T00:00:00.000Z"),
          digest: "abcdef1234567890",
          componentCount: 1,
        }}
        components={[
          {
            name: "vulnerable-lib",
            version: "1.2.0",
            componentType: "library",
            ecosystem: "npm",
            packageUrl: "pkg:npm/vulnerable-lib@1.2.0",
            lifecycleMilestones: [],
          },
        ]}
        findingSummary={emptyFindings}
        scanner={noScanner}
        findings={[
          {
            findingKey: "fk-1",
            findingKind: "vulnerability",
            title: "Critical issue in vulnerable-lib",
            status: "open",
            policySeverity: "critical",
            releaseImpact: "block",
            adapterKey: "pnpm-audit",
            vendorIdentifier: "GHSA-1111",
            affectedType: "bom-component",
            affectedId: "key-vulnerable",
            lastSeenAt: new Date("2026-05-22T12:00:00.000Z"),
            component: {
              name: "vulnerable-lib",
              version: "1.2.0",
              packageUrl: "pkg:npm/vulnerable-lib@1.2.0",
            },
            backlogItemId: null,
            autoFileReason: null,
          },
        ]}
      />,
    );

    expect(screen.getByText("Active findings")).toBeInTheDocument();
    expect(screen.getByText("Critical issue in vulnerable-lib")).toBeInTheDocument();
    // Read-only at product level - no controls.
    expect(screen.queryByTestId("assurance-finding-status-select")).not.toBeInTheDocument();
    expect(screen.queryByTestId("assurance-finding-create-backlog")).not.toBeInTheDocument();
  });
});
