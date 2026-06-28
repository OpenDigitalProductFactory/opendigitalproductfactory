import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import EndpointPerformancePanel from "./EndpointPerformancePanel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/endpoint-performance", () => ({
  triggerEndpointTests: vi.fn(),
}));

describe("EndpointPerformancePanel", () => {
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
