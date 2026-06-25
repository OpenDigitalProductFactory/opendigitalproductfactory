import { describe, expect, it, vi } from "vitest";
import {
  correlateAndPersistIncidents,
  ticketIdForIncident,
  type EdgeCorrelationDb,
} from "./edge-incident-correlation";

const T = (iso: string) => new Date(iso);

function mockDb(over: {
  edgeEvents?: unknown[];
  changeEvents?: unknown[];
} = {}) {
  const qiUpsert = vi.fn().mockResolvedValue({});
  const stUpsert = vi.fn().mockResolvedValue({});
  const db = {
    edgeEvent: { findMany: vi.fn().mockResolvedValue(over.edgeEvents ?? []) },
    changeEvent: { findMany: vi.fn().mockResolvedValue(over.changeEvents ?? []) },
    portfolioQualityIssue: { upsert: qiUpsert },
    serviceTicket: { upsert: stUpsert },
  } as unknown as EdgeCorrelationDb;
  return { db, qiUpsert, stUpsert };
}

function alertRow(over: Record<string, unknown> = {}) {
  return {
    id: "a1",
    edgeNodeId: "node_1",
    dedupKey: "k1",
    severity: "error",
    eventClass: "interface_down",
    source: "snmp.trap",
    summary: "iface down",
    status: "triggered",
    occurredAt: T("2026-06-24T02:31:00Z"),
    node: { customerAccountId: "acc_a", customerSiteId: "s1" },
    ...over,
  };
}

describe("ticketIdForIncident", () => {
  it("is deterministic and ST-prefixed", () => {
    const a = ticketIdForIncident("edge-incident|node_1|deploy|t");
    const b = ticketIdForIncident("edge-incident|node_1|deploy|t");
    expect(a).toBe(b);
    expect(a).toMatch(/^ST-[0-9A-F]{10}$/);
  });
});

describe("correlateAndPersistIncidents (A2+A3 runtime)", () => {
  it("correlates a storm to a change and persists a customer-scoped incident + ticket", async () => {
    const { db, qiUpsert, stUpsert } = mockDb({
      edgeEvents: [
        alertRow({ id: "a1", dedupKey: "k1", occurredAt: T("2026-06-24T02:31:00Z") }),
        alertRow({ id: "a2", dedupKey: "k2", occurredAt: T("2026-06-24T02:32:00Z") }),
        alertRow({ id: "a3", dedupKey: "k3", occurredAt: T("2026-06-24T02:33:00Z") }),
      ],
      changeEvents: [
        { id: "c1", edgeNodeId: "node_1", changeKey: "deploy-abc", source: "git.deploy", summary: "ship v2", occurredAt: T("2026-06-24T02:28:00Z") },
      ],
    });

    const result = await correlateAndPersistIncidents(db, { now: T("2026-06-24T02:35:00Z") });

    expect(result).toEqual({ alerts: 3, changes: 1, incidents: 1, ticketsUpserted: 1 });

    // Incident persisted to the operator inbox, customer-scoped.
    const qi = qiUpsert.mock.calls[0][0];
    expect(qi.create.issueType).toBe("edge_correlated_incident");
    expect(qi.create.customerAccountId).toBe("acc_a");
    expect(qi.create.scopeKey).toBe("customer:acc_a:site:s1");

    // ServiceTicket upserted with a deterministic id, correlation linkage, scope.
    const st = stUpsert.mock.calls[0][0];
    expect(st.where.ticketId).toMatch(/^ST-[0-9A-F]{10}$/);
    expect(st.create.ticketKind).toBe("incident");
    expect(st.create.correlatedIncidentKey).toBe(qi.where.issueKey);
    expect(st.create.customerAccountId).toBe("acc_a");
    expect(st.create.scopeKey).toBe("customer:acc_a:site:s1");
    // Recurrence-safe: update does not clobber operator status/ownership.
    expect(st.update.status).toBeUndefined();
  });

  it("defaults to organization-internal scope when the node has no customer", async () => {
    const { db, qiUpsert } = mockDb({
      edgeEvents: [alertRow({ severity: "critical", node: { customerAccountId: null, customerSiteId: null } })],
      changeEvents: [],
    });
    const result = await correlateAndPersistIncidents(db, { now: T("2026-06-24T02:35:00Z") });
    expect(result.incidents).toBe(1);
    expect(qiUpsert.mock.calls[0][0].create.scopeKey).toBe("organization:internal");
  });

  it("no active alerts -> no incidents, no writes", async () => {
    const { db, qiUpsert, stUpsert } = mockDb({ edgeEvents: [], changeEvents: [] });
    const result = await correlateAndPersistIncidents(db, {});
    expect(result).toEqual({ alerts: 0, changes: 0, incidents: 0, ticketsUpserted: 0 });
    expect(qiUpsert).not.toHaveBeenCalled();
    expect(stUpsert).not.toHaveBeenCalled();
  });
});
