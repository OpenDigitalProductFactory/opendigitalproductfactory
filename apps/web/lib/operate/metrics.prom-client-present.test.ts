// BI-PIR-53d2c42d companion: when prom-client IS installed (the Next server),
// the guarded loader must build every metric on the real registry, so
// /api/metrics output is unchanged by making prom-client optional.

import { describe, expect, it } from "vitest";

describe("lib/operate/metrics with prom-client installed", () => {
  it("records into a real prom-client registry", async () => {
    const m = await import("./metrics");
    expect(m.metricsBackendAvailable).toBe(true);

    m.httpRequestsTotal.inc({ method: "GET", route: "/probe", status_code: "200" });
    const text = await m.metricsRegistry.metrics();

    // Default Node runtime metrics are still collected under the dpf_ prefix.
    expect(text).toContain("dpf_process_cpu_user_seconds_total");
    expect(text).toContain('dpf_http_requests_total{method="GET",route="/probe",status_code="200"} 1');
    // Untouched metrics still expose HELP/TYPE, exactly as eager construction did.
    expect(text).toContain("# TYPE dpf_postgres_backup_runs_total counter");
    expect(m.metricsRegistry.contentType).toContain("text/plain");
  });
});
