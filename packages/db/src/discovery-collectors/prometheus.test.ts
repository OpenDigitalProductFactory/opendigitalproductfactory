import { describe, it, expect, vi } from "vitest";
import { collectPrometheusDiscovery, classifyPrometheusJob } from "./prometheus";

describe("classifyPrometheusJob", () => {
  it("classifies postgres as database", () => {
    const r = classifyPrometheusJob("postgres");
    expect(r.itemType).toBe("database");
    expect(r.confidence).toBeGreaterThanOrEqual(0.90);
  });

  it("classifies neo4j as database", () => {
    expect(classifyPrometheusJob("neo4j").itemType).toBe("database");
  });

  it("classifies qdrant as database", () => {
    expect(classifyPrometheusJob("qdrant").itemType).toBe("database");
  });

  it("classifies portal as application", () => {
    const r = classifyPrometheusJob("portal");
    expect(r.itemType).toBe("application");
    expect(r.confidence).toBeGreaterThanOrEqual(0.90);
  });

  it("classifies sandbox as application", () => {
    expect(classifyPrometheusJob("sandbox").itemType).toBe("application");
  });

  it("classifies model-runner as ai_service", () => {
    const r = classifyPrometheusJob("model-runner");
    expect(r.itemType).toBe("ai_service");
    expect(r.confidence).toBeGreaterThanOrEqual(0.90);
  });

  it("classifies cadvisor as monitoring_service", () => {
    expect(classifyPrometheusJob("cadvisor").itemType).toBe("monitoring_service");
  });

  it("classifies node-exporter as monitoring_service", () => {
    expect(classifyPrometheusJob("node-exporter").itemType).toBe("monitoring_service");
  });

  it("classifies prometheus as monitoring_service", () => {
    expect(classifyPrometheusJob("prometheus").itemType).toBe("monitoring_service");
  });

  it("returns service with low confidence for unknown jobs", () => {
    const r = classifyPrometheusJob("some-custom-thing");
    expect(r.itemType).toBe("service");
    expect(r.confidence).toBe(0.5);
  });
});

describe("collectPrometheusDiscovery", () => {
  it("produces items from active targets", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          activeTargets: [
            { labels: { job: "postgres", instance: "postgres:5432" }, health: "up", scrapePool: "postgres", lastScrape: "2026-04-02T00:00:00Z" },
            { labels: { job: "neo4j", instance: "neo4j:2004" }, health: "up", scrapePool: "neo4j", lastScrape: "2026-04-02T00:00:00Z" },
          ],
          droppedTargets: [],
        },
      }),
    });

    const result = await collectPrometheusDiscovery(undefined, { fetchFn: mockFetch, prometheusUrl: "http://prometheus:9090" });

    expect(result.items).toHaveLength(2);
    expect(result.items[0].itemType).toBe("database");
    expect(result.items[0].name).toBe("postgres");
    expect(result.items[0].sourceKind).toBe("prometheus");
    expect(result.items[0].naturalKey).toBe("prom:postgres:postgres:5432");
    expect(result.items[1].itemType).toBe("database");
    expect(result.items[1].name).toBe("neo4j");
  });

  it("creates monitors relationships from prometheus to other targets", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          activeTargets: [
            { labels: { job: "prometheus", instance: "localhost:9090" }, health: "up", scrapePool: "prometheus", lastScrape: "2026-04-02T00:00:00Z" },
            { labels: { job: "postgres", instance: "postgres:5432" }, health: "up", scrapePool: "postgres", lastScrape: "2026-04-02T00:00:00Z" },
          ],
          droppedTargets: [],
        },
      }),
    });

    const result = await collectPrometheusDiscovery(undefined, { fetchFn: mockFetch, prometheusUrl: "http://prometheus:9090" });

    const monitorRels = result.relationships.filter((r) => r.relationshipType === "monitors");
    expect(monitorRels.length).toBeGreaterThanOrEqual(1);
    expect(monitorRels[0].fromExternalRef).toContain("prometheus");
    expect(monitorRels[0].toExternalRef).toContain("postgres");
  });

  it("returns empty output when prometheus is unreachable", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await collectPrometheusDiscovery(undefined, { fetchFn: mockFetch, prometheusUrl: "http://prometheus:9090" });

    expect(result.items).toHaveLength(0);
    expect(result.relationships).toHaveLength(0);
    expect(result.warnings).toContain("prometheus_unreachable");
  });

  it("returns empty output when prometheus returns non-ok status", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });

    const result = await collectPrometheusDiscovery(undefined, { fetchFn: mockFetch, prometheusUrl: "http://prometheus:9090" });

    expect(result.items).toHaveLength(0);
    expect(result.warnings).toContain("prometheus_unreachable");
  });

  it("deduplicates targets with same job name", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          activeTargets: [
            { labels: { job: "sandbox", instance: "sandbox:3000" }, health: "up", scrapePool: "sandbox", lastScrape: "2026-04-02T00:00:00Z" },
            { labels: { job: "sandbox", instance: "sandbox-2:3000" }, health: "up", scrapePool: "sandbox", lastScrape: "2026-04-02T00:00:00Z" },
            { labels: { job: "sandbox", instance: "sandbox-3:3000" }, health: "up", scrapePool: "sandbox", lastScrape: "2026-04-02T00:00:00Z" },
          ],
          droppedTargets: [],
        },
      }),
    });

    const result = await collectPrometheusDiscovery(undefined, { fetchFn: mockFetch, prometheusUrl: "http://prometheus:9090" });

    // Each instance is a separate item (different naturalKey)
    expect(result.items).toHaveLength(3);
    const keys = new Set(result.items.map((i) => i.naturalKey));
    expect(keys.size).toBe(3);
  });
});
