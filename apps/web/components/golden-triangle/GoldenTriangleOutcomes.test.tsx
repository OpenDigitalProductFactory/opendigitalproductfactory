// @vitest-environment jsdom
import "./test-setup";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { StoredReceipt } from "@/lib/golden-triangle/receipt-store";

import { GoldenTriangleOutcomes } from "./GoldenTriangleOutcomes";

function stored(overrides: Partial<StoredReceipt["receipt"]> = {}, top: Partial<StoredReceipt> = {}): StoredReceipt {
  return {
    interactionId: top.interactionId ?? "i1",
    routeContext: top.routeContext ?? "build-studio",
    at: top.at ?? "2026-06-22T10:00:00.000Z",
    receipt: {
      preset: "assured",
      governedBy: "platform",
      requested: { minimumTier: "frontier" },
      actual: { modelId: "claude-opus-4-7", tier: "frontier", costUsd: 0.12, latencyMs: 14000, fallbackOccurred: false, verificationPassed: null, accepted: null },
      deviations: [],
      matchedRequest: true,
      summary: "Assured (frontier tier): ran on claude-opus-4-7 (frontier tier) — matched. $0.120, 14.0s.",
      ...overrides,
    },
  };
}

describe("GoldenTriangleOutcomes", () => {
  it("shows an honest empty state when there are no receipts", () => {
    render(<GoldenTriangleOutcomes receipts={[]} />);
    expect(screen.getByText(/No outcome receipts yet/)).toBeTruthy();
  });

  it("renders a matched receipt with its summary and surface", () => {
    render(<GoldenTriangleOutcomes receipts={[stored()]} />);
    expect(screen.getByText("Matched")).toBeTruthy();
    expect(screen.getByText(/ran on claude-opus-4-7/)).toBeTruthy();
    expect(screen.getByText(/surface: build-studio/)).toBeTruthy();
  });

  it("labels a downgraded run as Deviated", () => {
    const r = stored({ matchedRequest: false, summary: "Assured (frontier tier): ran on gpt-4o-mini (adequate tier) — below the requested tier. $0.002, 3.0s." }, { interactionId: "i2" });
    render(<GoldenTriangleOutcomes receipts={[r]} />);
    expect(screen.getByText("Deviated")).toBeTruthy();
  });

  it("renders the calibration banner when a suggestion is provided", () => {
    render(
      <GoldenTriangleOutcomes
        receipts={[stored()]}
        suggestion={{ kind: "loosen-quality", headline: "You may have room to save", detail: "All runs ran clean.", sampleSize: 8 }}
      />,
    );
    expect(screen.getByText("You may have room to save")).toBeTruthy();
    expect(screen.getByText(/learned from 8 runs/)).toBeTruthy();
  });
});
