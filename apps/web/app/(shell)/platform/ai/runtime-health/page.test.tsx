import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ModelSelectionOverview } from "@/lib/inference/phase-model-resolution";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/i18n/locale-context.server", () => ({
  getLocaleContext: vi.fn().mockResolvedValue({ language: "en-US" }),
}));

vi.mock("@/lib/inference/phase-model-resolution", () => ({
  resolveModelSelectionByPhase: vi.fn().mockResolvedValue(routingOverview([false, false, false, false, false])),
}));

vi.mock("@/lib/coworker-service-catalog/routing-reachability-preflight", () => ({
  computeCoworkerRoutingReachability: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/platform-runtime/service-health-loader", () => ({
  loadCapabilityServiceHealth: vi.fn().mockResolvedValue({
    aggregate: { value: "Operational", tone: "success", detail: "Required services available" },
    items: [{
      key: "speech-to-text",
      kind: "service",
      state: "optional_inactive",
      availability: "inactive",
      label: "Optional — inactive",
      action: "Enable its runtime capability when this service is needed.",
      tone: "neutral",
      healthSemantics: "http",
    }],
  }),
}));

vi.mock("@/lib/queue/queue-snapshot-service", () => ({
  readQueueSnapshots: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/queue/job-engine-health", () => ({
  getJobEngineHealth: vi.fn().mockResolvedValue({
    status: "healthy",
    detail: null,
    checkedAt: null,
    watchdog: {
      status: "healthy",
      lastInvocationAt: null,
      lastRecoveryAttemptAt: null,
      lastRecoverySummary: null,
    },
  }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: any }) => (
    <a href={href}>{children}</a>
  ),
}));

describe("RuntimeHealthPage", () => {
  it.each([
    { locations: [false, null, null, null, false], summary: "2 resolved: 0 local, 2 cloud." },
    { locations: [true, null, null, null, true], summary: "2 resolved: 2 local, 0 cloud." },
    { locations: [true, null, null, null, false], summary: "2 resolved: 1 local, 1 cloud." },
  ])("leads with unresolved availability when resolved locations are $locations", async ({ locations, summary }) => {
    const { resolveModelSelectionByPhase } = await import("@/lib/inference/phase-model-resolution");
    vi.mocked(resolveModelSelectionByPhase).mockResolvedValueOnce(routingOverview(locations));
    const { default: RuntimeHealthPage } = await import("./page");

    const html = renderToStaticMarkup(await RuntimeHealthPage());

    expect(html).toContain("3 of 5 phases unresolved");
    expect(html).toContain(summary);
    expect(html).not.toContain("All phases route to cloud");
    expect(html).not.toContain("All phases run locally");
    expect(html).toMatch(/color:var\(--dpf-error\)[^>]*>3 of 5 phases unresolved/);
  });

  it("reports unavailable phase evidence without repeating a healthy location summary", async () => {
    const { resolveModelSelectionByPhase } = await import("@/lib/inference/phase-model-resolution");
    vi.mocked(resolveModelSelectionByPhase).mockResolvedValueOnce(routingOverview([]));
    const { default: RuntimeHealthPage } = await import("./page");

    const html = renderToStaticMarkup(await RuntimeHealthPage());

    expect(html).toContain("Phase routing unavailable");
    expect(html).not.toContain("All phases route to cloud");
  });

  it.each([
    { locations: [true, true, true, true, true], title: "All phases run locally" },
    { locations: [false, false, false, false, false], title: "All phases route to cloud" },
    { locations: [true, false, true, false, false], title: "Mixed: local + cloud" },
  ])("preserves complete routing location: $title", async ({ locations, title }) => {
    const { resolveModelSelectionByPhase } = await import("@/lib/inference/phase-model-resolution");
    vi.mocked(resolveModelSelectionByPhase).mockResolvedValueOnce(routingOverview(locations));
    const { default: RuntimeHealthPage } = await import("./page");
    const html = renderToStaticMarkup(await RuntimeHealthPage());
    expect(html).toContain(title);
    expect(html).not.toContain("phases unresolved");
  });

  it("keeps errors prominent even when a location was selected for every phase", async () => {
    const { resolveModelSelectionByPhase } = await import("@/lib/inference/phase-model-resolution");
    const overview = routingOverview([true, true, true, true, true]);
    overview.flags = [{ phase: "build", severity: "error", code: "context-too-small", message: "Context too small", remediation: "Review serving configuration" }];
    vi.mocked(resolveModelSelectionByPhase).mockResolvedValueOnce(overview);
    const { default: RuntimeHealthPage } = await import("./page");
    const html = renderToStaticMarkup(await RuntimeHealthPage());
    expect(html).toContain("Phase routing needs attention");
    expect(html).not.toContain("All phases run locally");
  });

  it("links operators back to the AI readiness console", async () => {
    const { default: RuntimeHealthPage } = await import("./page");
    const html = renderToStaticMarkup(await RuntimeHealthPage());

    expect(html).toContain("Model Selection &amp; Runtime Health");
    expect(html).toContain("All phases route to cloud providers.");
    expect(html).toContain('href="/platform/ai/readiness"');
    expect(html).toContain("Capability service requirements");
    expect(html).toContain("Optional — inactive");
    expect(html).toContain('data-testid="phase-routing-table-scroll"');
    expect(html).toContain('min-width:0');
    expect(html).toContain('max-width:100%');
  });

  it("does not infer service requirements when capability authority is unavailable", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { loadCapabilityServiceHealth } = await import("@/lib/platform-runtime/service-health-loader");
    vi.mocked(loadCapabilityServiceHealth).mockRejectedValueOnce(new Error("install_catalog_stale"));
    const { default: RuntimeHealthPage } = await import("./page");

    const html = renderToStaticMarkup(await RuntimeHealthPage());

    expect(html).toContain("Capability authority is unavailable");
    expect(html).toContain("Service requirements cannot be classified safely right now.");
    expect(html).not.toContain("install_catalog_stale");
    expect(html).not.toContain("Optional — inactive");
    expect(JSON.stringify(log.mock.calls)).not.toContain("install_catalog_stale");
    expect(log).toHaveBeenCalledWith("[runtime-health] read unavailable", expect.objectContaining({
      event: "runtime_health_read_unavailable",
      source: "capability-authority",
    }));
    log.mockRestore();
  });

  it("starts independent health reads concurrently", async () => {
    const { resolveModelSelectionByPhase } = await import("@/lib/inference/phase-model-resolution");
    const { loadCapabilityServiceHealth } = await import("@/lib/platform-runtime/service-health-loader");
    const { readQueueSnapshots } = await import("@/lib/queue/queue-snapshot-service");
    const { getJobEngineHealth } = await import("@/lib/queue/job-engine-health");
    const model = deferred<Awaited<ReturnType<typeof resolveModelSelectionByPhase>>>();
    const capability = deferred<Awaited<ReturnType<typeof loadCapabilityServiceHealth>>>();
    const queues = deferred<Awaited<ReturnType<typeof readQueueSnapshots>>>();
    const jobs = deferred<Awaited<ReturnType<typeof getJobEngineHealth>>>();
    vi.mocked(resolveModelSelectionByPhase).mockImplementationOnce(() => model.promise);
    vi.mocked(loadCapabilityServiceHealth).mockImplementationOnce(() => capability.promise);
    vi.mocked(readQueueSnapshots).mockImplementationOnce(() => queues.promise);
    vi.mocked(getJobEngineHealth).mockImplementationOnce(() => jobs.promise);
    const { default: RuntimeHealthPage } = await import("./page");

    const renderPromise = RuntimeHealthPage();
    await Promise.resolve();
    await Promise.resolve();

    expect(vi.mocked(resolveModelSelectionByPhase)).toHaveBeenCalled();
    expect(vi.mocked(loadCapabilityServiceHealth)).toHaveBeenCalled();
    expect(vi.mocked(readQueueSnapshots)).toHaveBeenCalled();
    expect(vi.mocked(getJobEngineHealth)).toHaveBeenCalled();

    model.resolve(routingOverview([false, false, false, false, false]));
    capability.resolve({ aggregate: { value: "Operational", tone: "success", detail: "Ready" }, items: [] });
    queues.resolve([]);
    jobs.resolve({
      status: "unknown", detail: null, checkedAt: null,
      watchdog: {
        status: "unknown", detail: null, lastInvocationAt: null, lastGatewayHitAt: null,
        lastRecoveryAttemptAt: null, lastRecoverySummary: null,
      },
    });
    await expect(renderPromise).resolves.toBeTruthy();
  });

  it("renders a missing required service and degraded aggregate", async () => {
    const { loadCapabilityServiceHealth } = await import("@/lib/platform-runtime/service-health-loader");
    vi.mocked(loadCapabilityServiceHealth).mockResolvedValueOnce({
      aggregate: { value: "Degraded", tone: "warning", detail: "portal requires attention" },
      items: [{
        key: "portal",
        kind: "service",
        state: "required",
        availability: "unavailable",
        label: "Required — unavailable",
        action: "Restore the service and verify its configured health check.",
        tone: "warning",
        healthSemantics: "http",
      }],
    });
    const { default: RuntimeHealthPage } = await import("./page");

    const html = renderToStaticMarkup(await RuntimeHealthPage());

    expect(html).toContain("Required — unavailable");
    expect(html).toContain("Degraded");
    expect(html).toContain("portal requires attention");
  });
});

function routingOverview(locations: (boolean | null)[]): ModelSelectionOverview {
  const phaseIds = ["ideate", "plan", "design-review", "plan-review", "build"] as const;
  const local = locations.filter((location) => location === true).length;
  const cloud = locations.filter((location) => location === false).length;
  return {
    verdict: local > 0 ? (cloud > 0 ? "mixed" : "all-local") : "all-cloud",
    summary: local > 0 ? (cloud > 0 ? `Mixed: ${local} local, ${cloud} cloud.` : "All phases run locally.") : "All phases route to cloud providers.",
    buildEngine: "codex", buildEngineLabel: "Codex CLI",
    generatedAt: "2026-06-29T00:00:00.000Z", notes: [], flags: [],
    phases: locations.map((isLocal, index) => ({
      phase: phaseIds[index], label: phaseIds[index], governedBy: "providers-routing",
      mechanism: "routed", engine: "Portal routing", isLocal,
      providerId: isLocal === null ? null : isLocal ? "local" : "codex",
      modelId: isLocal === null ? null : "test-model", providerTier: null,
      contextTokens: null, rationale: "Test routing evidence", flags: [],
    })),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
