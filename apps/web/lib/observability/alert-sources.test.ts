import { describe, it, expect, vi } from "vitest";
import { fetchAlertSources } from "./alert-sources";

function okResp(alerts: unknown[]) {
  return { ok: true, json: async () => ({ status: "success", data: { alerts } }) } as unknown as Response;
}
function badStatusResp() {
  return { ok: true, json: async () => ({ status: "error", data: { alerts: [] } }) } as unknown as Response;
}
function httpErrResp() {
  return { ok: false, json: async () => ({}) } as unknown as Response;
}

const promAlert = { labels: { alertname: "PostgresDown", severity: "critical" }, annotations: { summary: "pg down" }, state: "firing", activeAt: "2026-06-15T00:00:00Z" };
const lokiAlert = { labels: { alertname: "ContainerErrorLogSpike", service: "sandbox", severity: "warning", source: "log-rate" }, annotations: { summary: "sandbox spike" }, state: "pending", value: "140" };

function routedFetch(promImpl: () => Response, lokiImpl: () => Response) {
  return vi.fn(async (url: string) => (url.includes("3100") || url.includes("loki") ? lokiImpl() : promImpl()));
}

describe("fetchAlertSources", () => {
  it("merges Prometheus + Loki ruler alerts, tagging sourceSystem", async () => {
    const fetchImpl = routedFetch(() => okResp([promAlert]), () => okResp([lokiAlert]));
    const res = await fetchAlertSources({ fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(res.reached).toEqual({ prometheus: true, "loki-ruler": true });
    expect(res.alerts).toHaveLength(2);
    const byName = Object.fromEntries(res.alerts.map((a) => [a.labels.alertname, a]));
    expect(byName.PostgresDown.sourceSystem).toBe("prometheus");
    expect(byName.ContainerErrorLogSpike.sourceSystem).toBe("loki-ruler");
    // preserves state + value for downstream filtering
    expect(byName.ContainerErrorLogSpike.state).toBe("pending");
    expect(byName.ContainerErrorLogSpike.value).toBe("140");
  });

  it("keeps the other source when one is unreachable (no cross-suppression)", async () => {
    const fetchImpl = routedFetch(
      () => { throw new Error("ECONNREFUSED"); },
      () => okResp([lokiAlert]),
    );
    const res = await fetchAlertSources({ fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(res.reached.prometheus).toBe(false);
    expect(res.reached["loki-ruler"]).toBe(true);
    expect(res.alerts).toHaveLength(1);
    expect(res.alerts[0].sourceSystem).toBe("loki-ruler");
  });

  it("marks a source unreached on HTTP error or non-success body", async () => {
    const res1 = await fetchAlertSources({
      fetchImpl: routedFetch(() => httpErrResp(), () => okResp([lokiAlert])) as unknown as typeof fetch,
    });
    expect(res1.reached.prometheus).toBe(false);

    const res2 = await fetchAlertSources({
      fetchImpl: routedFetch(() => okResp([promAlert]), () => badStatusResp()) as unknown as typeof fetch,
    });
    expect(res2.reached["loki-ruler"]).toBe(false);
    expect(res2.alerts).toHaveLength(1);
  });

  it("reports both unreached when both fail", async () => {
    const res = await fetchAlertSources({
      fetchImpl: routedFetch(() => { throw new Error("x"); }, () => { throw new Error("y"); }) as unknown as typeof fetch,
    });
    expect(res.reached).toEqual({ prometheus: false, "loki-ruler": false });
    expect(res.alerts).toEqual([]);
  });
});
