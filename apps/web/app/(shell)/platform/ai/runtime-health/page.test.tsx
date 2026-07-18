import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/inference/phase-model-resolution", () => ({
  resolveModelSelectionByPhase: vi.fn().mockResolvedValue({
    verdict: "all-cloud",
    summary: "All phases route to cloud providers.",
    buildEngine: "codex",
    buildEngineLabel: "Codex CLI",
    generatedAt: "2026-06-29T00:00:00.000Z",
    notes: ["Provider routing resolves the model supply."],
    phases: [],
    flags: [],
  }),
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
  it("links operators back to the AI readiness console", async () => {
    const { default: RuntimeHealthPage } = await import("./page");
    const html = renderToStaticMarkup(await RuntimeHealthPage());

    expect(html).toContain("Model Selection &amp; Runtime Health");
    expect(html).toContain("All phases route to cloud providers.");
    expect(html).toContain('href="/platform/ai/readiness"');
    expect(html).toContain("Capability service requirements");
    expect(html).toContain("Optional — inactive");
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

    model.resolve({
      verdict: "all-cloud",
      summary: "All phases route to cloud providers.",
      buildEngine: "codex",
      buildEngineLabel: "Codex CLI",
      generatedAt: "2026-06-29T00:00:00.000Z",
      notes: [], phases: [], flags: [],
    });
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
