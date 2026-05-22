// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuildAssuranceGateCard } from "./BuildAssuranceGateCard";

vi.mock("@/lib/actions/assurance", () => ({
  requestBuildBomGeneration: vi.fn(async () => ({ queued: true })),
  requestBuildAssuranceScan: vi.fn(async () => ({ queued: true })),
  setAssuranceFindingStatus: vi.fn(async () => ({ findingKey: "fk-1", previousStatus: "open", status: "planned" })),
  requestBacklogFromAssuranceFinding: vi.fn(async () => ({
    findingKey: "fk-1",
    backlogItemId: "BI-NEW",
    epicCuid: "epic-cuid",
    alreadyLinked: false,
  })),
}));

import {
  requestBuildAssuranceScan,
  requestBuildBomGeneration,
} from "@/lib/actions/assurance";

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

describe("BuildAssuranceGateCard", () => {
  it("shows an honest missing-BOM state", () => {
    render(
      <BuildAssuranceGateCard
        buildId="BUILD-1"
        summary={{
          state: "missing",
          document: null,
          counts: { components: 0, models: 0 },
          findings: emptyFindings,
          scanner: noScanner,
        }}
      />,
    );

    expect(screen.getByText("Assurance Gate")).toBeInTheDocument();
    expect(screen.getByText("No BOM generated")).toBeInTheDocument();
    expect(screen.getByText("No approved vulnerability scanner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generate BOM/i })).toBeInTheDocument();
  });

  it("shows component and model counts when a BOM exists", () => {
    render(
      <BuildAssuranceGateCard
        buildId="BUILD-1"
        summary={{
          state: "current",
          document: {
            documentId: "bom_abc",
            digest: "abc123",
            generatedAt: new Date("2026-05-22T00:00:00.000Z"),
            componentCount: 12,
            sourceKind: "pnpm-lock",
          },
          counts: { components: 12, models: 2 },
          findings: emptyFindings,
          scanner: noScanner,
        }}
      />,
    );

    expect(screen.getByText("Scanner not approved")).toBeInTheDocument();
    expect(screen.getByText("12 components")).toBeInTheDocument();
    expect(screen.getByText("2 AI models")).toBeInTheDocument();
    expect(screen.getByText("0 active")).toBeInTheDocument();
  });

  it("queues a background BOM run without blocking the card", async () => {
    render(
      <BuildAssuranceGateCard
        buildId="BUILD-1"
        summary={{
          state: "missing",
          document: null,
          counts: { components: 0, models: 0 },
          findings: emptyFindings,
          scanner: noScanner,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Generate BOM/i }));

    await waitFor(() => {
      expect(requestBuildBomGeneration).toHaveBeenCalledWith("BUILD-1");
    });
  });

  it("shows blocking findings as a release gate signal", () => {
    render(
      <BuildAssuranceGateCard
        buildId="BUILD-1"
        summary={{
          state: "current",
          document: {
            documentId: "bom_abc",
            digest: "abc123",
            generatedAt: new Date("2026-05-22T00:00:00.000Z"),
            componentCount: 12,
            sourceKind: "pnpm-lock",
          },
          counts: { components: 12, models: 2 },
          findings: {
            ...emptyFindings,
            total: 3,
            blocking: 2,
            bySeverity: { critical: 1, high: 1, medium: 1, low: 0, info: 0 },
            byKind: { vulnerability: 2, license: 1 },
          },
          scanner: {
            state: "ready",
            approvedScannerCount: 1,
            scannerNames: ["Example Scanner"],
            reason: "approved-scanner-available",
          },
        }}
      />,
    );

    expect(screen.getByText("Assurance blocked")).toBeInTheDocument();
    expect(screen.getByText("2 blocking")).toBeInTheDocument();
  });

  it("queues an assurance scan when Run scan is clicked", async () => {
    render(
      <BuildAssuranceGateCard
        buildId="BUILD-1"
        summary={{
          state: "current",
          document: {
            documentId: "bom_abc",
            digest: "abc123",
            generatedAt: new Date("2026-05-22T00:00:00.000Z"),
            componentCount: 12,
            sourceKind: "pnpm-lock",
          },
          counts: { components: 12, models: 2 },
          findings: emptyFindings,
          scanner: noScanner,
        }}
      />,
    );

    fireEvent.click(screen.getByTestId("build-assurance-gate-run-scan"));

    await waitFor(() => {
      expect(requestBuildAssuranceScan).toHaveBeenCalledWith("BUILD-1");
    });
  });

  it("disables Run scan when no BOM exists yet", () => {
    render(
      <BuildAssuranceGateCard
        buildId="BUILD-1"
        summary={{
          state: "missing",
          document: null,
          counts: { components: 0, models: 0 },
          findings: emptyFindings,
          scanner: noScanner,
        }}
      />,
    );

    expect(screen.getByTestId("build-assurance-gate-run-scan")).toBeDisabled();
  });

  it("renders the active findings section with an empty hint when no findings exist", () => {
    render(
      <BuildAssuranceGateCard
        buildId="BUILD-1"
        summary={{
          state: "missing",
          document: null,
          counts: { components: 0, models: 0 },
          findings: emptyFindings,
          scanner: noScanner,
        }}
        findings={[]}
      />,
    );

    expect(screen.getByText("Active findings")).toBeInTheDocument();
    expect(screen.getByText("Generate a BOM, then run a scan.")).toBeInTheDocument();
  });

  it("renders supplied findings inside the gate card", () => {
    render(
      <BuildAssuranceGateCard
        buildId="BUILD-1"
        summary={{
          state: "current",
          document: {
            documentId: "bom_abc",
            digest: "abc123",
            generatedAt: new Date("2026-05-22T00:00:00.000Z"),
            componentCount: 12,
            sourceKind: "pnpm-lock",
          },
          counts: { components: 12, models: 2 },
          findings: emptyFindings,
          scanner: noScanner,
        }}
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
          },
        ]}
      />,
    );

    expect(screen.getByText("Critical issue in vulnerable-lib")).toBeInTheDocument();
    expect(screen.getByText("vulnerable-lib@1.2.0")).toBeInTheDocument();
  });
});
