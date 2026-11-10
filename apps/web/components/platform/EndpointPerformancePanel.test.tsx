// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

import EndpointPerformancePanel from "./EndpointPerformancePanel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/endpoint-performance", () => ({
  triggerEndpointTests: vi.fn(),
}));

describe("EndpointPerformancePanel", () => {
  afterEach(cleanup);
  it("shows the recorded partial measurement summary without claiming a complete-model score", () => {
    const summary = "Six dimensions measured; conversational quality remains unverified.";
    render(<EndpointPerformancePanel endpointId="chatgpt" performances={[]} recentEvals={[]}
      profile={null} testRuns={[{ runId: "DE-partial", modelId: "selected", probesPassed: 0, probesFailed: 0,
        scenariosPassed: 0, scenariosFailed: 0, avgScore: null, startedAt: "2026-10-14T10:00:00Z", status: "incomplete",
        results: { dimensions: [], summary } }]} />);
    fireEvent.click(screen.getByRole("button", { name: /Test Runs/ }));
    expect(screen.getByText(summary)).toBeTruthy();
    expect(screen.getByText("incomplete")).toBeTruthy();
    expect(screen.queryByText(/Avg score:/)).toBeNull();
  });
  it("uses the recorded evaluation kind for score scale and omits absent probes", () => {
    const common = { modelId: null, probesPassed: 0, probesFailed: 0, scenariosPassed: 0,
      scenariosFailed: 0, startedAt: "2026-10-14T10:00:00Z", status: "completed" };
    render(<EndpointPerformancePanel endpointId="anthropic" performances={[]} recentEvals={[]}
      profile={null} showDiagnostics testRuns={[
        { ...common, runId: "dimension", avgScore: 75.7, results: { dimensions: [] } },
        { ...common, runId: "dimension-low", avgScore: 4.2, results: { dimensions: [] } },
        { ...common, runId: "legacy", probesPassed: 1, avgScore: 4.2, results: { probes: [] } },
        { ...common, runId: "incomplete", status: "incomplete", avgScore: null, results: { dimensions: [] } },
      ]} />);
    fireEvent.click(screen.getByRole("button", { name: /Test Runs/ }));
    expect(screen.getByText("Avg score: 75.7/100")).toBeTruthy();
    expect(screen.getByText("Avg score: 4.2/100")).toBeTruthy();
    expect(screen.getByText("Avg score: 4.2/5")).toBeTruthy();
    expect(screen.getByText("Probes: 1/1 passed")).toBeTruthy();
    expect(screen.queryByText("Probes: 0/0 passed")).toBeNull();
  });
  it("does not ask operators to manually run probes or full tests by default", () => {
    const html = renderToStaticMarkup(
      <EndpointPerformancePanel
        endpointId="zai"
        performances={[]}
        recentEvals={[]}
        testRuns={[]}
        profile={null}
      />,
    );

    expect(html).toContain("Endpoint Performance");
    expect(html).not.toContain("Run Probes");
    expect(html).not.toContain("Run Full Tests");
    expect(html).not.toContain("Required for routing");
  });

  it("keeps manual probe controls available in diagnostics mode", () => {
    const html = renderToStaticMarkup(
      <EndpointPerformancePanel
        endpointId="zai"
        performances={[]}
        recentEvals={[]}
        testRuns={[]}
        profile={null}
        showDiagnostics={true}
      />,
    );

    expect(html).toContain("Run Probes");
    expect(html).toContain("Run Full Tests");
  });
});
