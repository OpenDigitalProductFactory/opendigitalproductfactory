import { describe, expect, it, vi } from "vitest";
import {
  correlateEdgeEvents,
  persistCorrelatedIncident,
  type CorrelationAlert,
  type CorrelationChange,
  type CorrelationDb,
} from "./edge-event-correlation";

const T = (iso: string) => new Date(iso);

function mkAlert(over: Partial<CorrelationAlert> = {}): CorrelationAlert {
  return {
    id: over.id ?? "a1",
    edgeNodeId: over.edgeNodeId ?? "node_1",
    dedupKey: over.dedupKey ?? "snmp:fw-01:interface_down",
    severity: over.severity ?? "error",
    eventClass: over.eventClass ?? "interface_down",
    source: over.source ?? "snmp.trap",
    summary: over.summary ?? "interface down",
    status: over.status ?? "triggered",
    occurredAt: over.occurredAt ?? T("2026-06-24T02:31:00Z"),
  };
}

function change(over: Partial<CorrelationChange> = {}): CorrelationChange {
  return {
    id: over.id ?? "c1",
    edgeNodeId: over.edgeNodeId ?? "node_1",
    changeKey: over.changeKey ?? "deploy-abc123",
    source: over.source ?? "git.deploy",
    summary: over.summary ?? "ship v2",
    occurredAt: over.occurredAt ?? T("2026-06-24T02:28:00Z"),
  };
}

describe("correlateEdgeEvents (A2 / BI-0A9D7F60)", () => {
  it("correlates an alert storm to the preceding change with lead time", () => {
    const alerts = [
      mkAlert({ id: "a1", dedupKey: "k1", occurredAt: T("2026-06-24T02:31:00Z") }),
      mkAlert({ id: "a2", dedupKey: "k2", occurredAt: T("2026-06-24T02:32:00Z") }),
      mkAlert({ id: "a3", dedupKey: "k3", occurredAt: T("2026-06-24T02:33:00Z") }),
    ];
    const [incident] = correlateEdgeEvents(alerts, [change()]);
    expect(incident.alertCount).toBe(3);
    expect(incident.onsetAt).toEqual(T("2026-06-24T02:31:00Z"));
    expect(incident.triggeringChange?.changeKey).toBe("deploy-abc123");
    expect(incident.triggeringChange?.leadTimeMs).toBe(3 * 60000); // 02:31 − 02:28
    expect(incident.summary).toContain("git.deploy");
    expect(incident.alertDedupKeys).toEqual(["k1", "k2", "k3"]);
  });

  it("produces an incident with no triggering change when none precedes the spike", () => {
    const alerts = [mkAlert({ id: "a1" }), mkAlert({ id: "a2", dedupKey: "k2" }), mkAlert({ id: "a3", dedupKey: "k3" })];
    const [incident] = correlateEdgeEvents(alerts, []);
    expect(incident.triggeringChange).toBeNull();
    expect(incident.summary).toContain("node_1");
  });

  it("does not correlate a change that falls outside the look-back window", () => {
    const oldChange = change({ occurredAt: T("2026-06-24T02:00:00Z") }); // 31 min before onset
    const alerts = [mkAlert({ id: "a1" }), mkAlert({ id: "a2", dedupKey: "k2" }), mkAlert({ id: "a3", dedupKey: "k3" })];
    const [incident] = correlateEdgeEvents(alerts, [oldChange], { windowMinutes: 15 });
    expect(incident.triggeringChange).toBeNull();
  });

  it("picks the most recent change within the window as the trigger", () => {
    const alerts = [mkAlert({ id: "a1" }), mkAlert({ id: "a2", dedupKey: "k2" }), mkAlert({ id: "a3", dedupKey: "k3" })];
    const incidents = correlateEdgeEvents(alerts, [
      change({ changeKey: "old", occurredAt: T("2026-06-24T02:20:00Z") }),
      change({ changeKey: "recent", occurredAt: T("2026-06-24T02:29:00Z") }),
    ]);
    expect(incidents[0].triggeringChange?.changeKey).toBe("recent");
  });

  it("treats a single critical alert as an incident even below the storm threshold", () => {
    const incidents = correlateEdgeEvents([mkAlert({ severity: "critical" })], []);
    expect(incidents).toHaveLength(1);
    expect(incidents[0].highestSeverity).toBe("critical");
  });

  it("ignores sub-threshold non-critical alerts (handled individually elsewhere)", () => {
    const incidents = correlateEdgeEvents([mkAlert({ severity: "warn" }), mkAlert({ id: "a2", dedupKey: "k2", severity: "warn" })], []);
    expect(incidents).toHaveLength(0);
  });

  it("excludes resolved/suppressed alerts from the cluster", () => {
    const incidents = correlateEdgeEvents(
      [
        mkAlert({ id: "a1", dedupKey: "k1", status: "resolved" }),
        mkAlert({ id: "a2", dedupKey: "k2", status: "suppressed" }),
        mkAlert({ id: "a3", dedupKey: "k3", status: "triggered", severity: "warn" }),
      ],
      [],
    );
    expect(incidents).toHaveLength(0); // only one active warn alert left -> below threshold
  });

  it("separates incidents per node", () => {
    const alerts = [
      mkAlert({ id: "a1", edgeNodeId: "node_1", severity: "critical" }),
      mkAlert({ id: "a2", edgeNodeId: "node_2", dedupKey: "k2", severity: "critical" }),
    ];
    const incidents = correlateEdgeEvents(alerts, []);
    expect(incidents).toHaveLength(2);
    expect(new Set(incidents.map((i) => i.edgeNodeId))).toEqual(new Set(["node_1", "node_2"]));
  });

  it("is idempotent: same spike yields the same incidentKey", () => {
    const alerts = [mkAlert({ id: "a1" }), mkAlert({ id: "a2", dedupKey: "k2" }), mkAlert({ id: "a3", dedupKey: "k3" })];
    const a = correlateEdgeEvents(alerts, [change()]);
    const b = correlateEdgeEvents(alerts, [change()]);
    expect(a[0].incidentKey).toBe(b[0].incidentKey);
  });
});

describe("persistCorrelatedIncident", () => {
  it("upserts a customer-scoped incident issue, idempotent on incidentKey", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const db = { portfolioQualityIssue: { upsert } } as unknown as CorrelationDb;
    const [incident] = correlateEdgeEvents(
      [mkAlert({ id: "a1" }), mkAlert({ id: "a2", dedupKey: "k2" }), mkAlert({ id: "a3", dedupKey: "k3" })],
      [change()],
    );
    const key = await persistCorrelatedIncident(db, incident, {
      customerAccountId: "acc_a",
      customerSiteId: "s1",
      scopeKey: "customer:acc_a:site:s1",
    });
    const arg = upsert.mock.calls[0][0];
    expect(arg.where.issueKey).toBe(key);
    expect(arg.create.issueType).toBe("edge_correlated_incident");
    expect(arg.create.customerAccountId).toBe("acc_a");
    expect(arg.create.scopeKey).toBe("customer:acc_a:site:s1");
    expect(arg.update.resolvedAt).toBeNull();
  });

  it("defaults to organization-internal scope when none provided", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const db = { portfolioQualityIssue: { upsert } } as unknown as CorrelationDb;
    const [incident] = correlateEdgeEvents([mkAlert({ severity: "critical" })], []);
    await persistCorrelatedIncident(db, incident);
    expect(upsert.mock.calls[0][0].create.scopeKey).toBe("organization:internal");
  });
});
