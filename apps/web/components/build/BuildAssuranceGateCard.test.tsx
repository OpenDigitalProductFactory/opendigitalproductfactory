// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuildAssuranceGateCard } from "./BuildAssuranceGateCard";

vi.mock("@/lib/actions/assurance", () => ({
  requestBuildBomGeneration: vi.fn(async () => ({ queued: true })),
}));

import { requestBuildBomGeneration } from "@/lib/actions/assurance";

afterEach(cleanup);

describe("BuildAssuranceGateCard", () => {
  it("shows an honest missing-BOM state", () => {
    render(
      <BuildAssuranceGateCard
        buildId="BUILD-1"
        summary={{ state: "missing", document: null, counts: { components: 0, models: 0 } }}
      />,
    );

    expect(screen.getByText("Assurance Gate")).toBeInTheDocument();
    expect(screen.getByText("No BOM generated")).toBeInTheDocument();
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
        }}
      />,
    );

    expect(screen.getByText("BOM current")).toBeInTheDocument();
    expect(screen.getByText("12 components")).toBeInTheDocument();
    expect(screen.getByText("2 AI models")).toBeInTheDocument();
  });

  it("queues a background BOM run without blocking the card", async () => {
    render(
      <BuildAssuranceGateCard
        buildId="BUILD-1"
        summary={{ state: "missing", document: null, counts: { components: 0, models: 0 } }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Generate BOM/i }));

    await waitFor(() => {
      expect(requestBuildBomGeneration).toHaveBeenCalledWith("BUILD-1");
    });
  });
});
