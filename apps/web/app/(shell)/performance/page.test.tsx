import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { loadBusinessPerformance } from "@/lib/performance/business-performance-provider";
import { auth } from "@/lib/auth";
import PerformancePage, { metadata } from "./page";

vi.mock("@/lib/performance/business-analysis-watch.server", () => ({
  listBusinessAnalysisWatchesFor: vi.fn(async () => []),
}));

vi.mock("@/lib/performance/business-performance-provider", () => ({
  loadBusinessPerformance: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

describe("PerformancePage", () => {
  beforeEach(() => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-owner" } } as never);
    vi.mocked(loadBusinessPerformance).mockResolvedValue({
      status: "not-configured",
      reason: "The first historical performance snapshot has not been computed yet.",
      asOf: null,
      metricValues: [],
      source: "business-performance-read-model",
      applicable: true,
    });
  });

  it("states its owner/manager purpose and renders a truthful setup state", async () => {
    const html = renderToStaticMarkup(await PerformancePage());

    expect(metadata.title).toBe("Performance");
    expect(html).toContain(">Performance<");
    expect(html).toContain("Review results, trends, and their operating evidence.");
    expect(html).toContain("Performance history is not ready yet");
    expect(html).toContain("We will not show made-up numbers.");
    expect(html).toContain('href="/workspace"');
    expect(html).toContain("data-dpf-lead");
    expect(html).toContain("data-owner-first-next-action");
    expect(html).toContain("data-dpf-primary-action");
    expect(html).not.toContain(">0<");
    expect(loadBusinessPerformance).toHaveBeenCalledWith({ userId: "user-owner" });
  });

  it("says the surface is unavailable (not pending) when the archetype has no metrics engine", async () => {
    // BI-F359E1E9: the not-applicable state must not imply a snapshot is coming.
    vi.mocked(loadBusinessPerformance).mockResolvedValue({
      status: "not-configured",
      reason:
        "Performance snapshots are not available for this business type yet — the metrics engine currently covers hospitality operations.",
      asOf: null,
      metricValues: [],
      source: "business-performance-read-model",
      applicable: false,
    });

    const html = renderToStaticMarkup(await PerformancePage());

    expect(html).toContain("Performance isn&#x27;t available for this business type");
    expect(html).toContain("not available for this business type yet");
    expect(html).not.toContain("Performance history is not ready yet");
    expect(html).not.toContain("We will not show made-up numbers.");
  });

  it("does not add a second primary or local navigation component", async () => {
    const html = renderToStaticMarkup(await PerformancePage());

    expect(html).not.toContain("<nav");
    expect(html).not.toContain("data-component=\"app-rail\"");
  });
});
