import { describe, it, expect, vi } from "vitest";
import {
  healthAlertIssueKey,
  upsertHealthAlertIssue,
  resolveHealthAlertIssue,
  type HealthAlertDb,
} from "./health-alert-issue";

function mockDb() {
  // Bare vi.fn() so recorded call args type as `any` (a typed-impl mock would
  // infer an empty arg tuple and break .mock.calls[0][0] indexing).
  const upsert = vi.fn().mockResolvedValue({});
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const db = { portfolioQualityIssue: { upsert, updateMany } } as unknown as HealthAlertDb;
  return { db, upsert, updateMany };
}

describe("healthAlertIssueKey", () => {
  it("scopes by service so two services firing the same alert are distinct", () => {
    expect(healthAlertIssueKey({ alertname: "ContainerErrorLogSpike", service: "sandbox" }))
      .toBe("health-alert-ContainerErrorLogSpike:sandbox");
    expect(healthAlertIssueKey({ alertname: "ContainerErrorLogSpike", service: "portal" }))
      .toBe("health-alert-ContainerErrorLogSpike:portal");
  });

  it("falls back instance -> job -> bare alertname", () => {
    expect(healthAlertIssueKey({ alertname: "X", instance: "sandbox:3000" })).toBe("health-alert-X:sandbox:3000");
    expect(healthAlertIssueKey({ alertname: "X", job: "qdrant" })).toBe("health-alert-X:qdrant");
    expect(healthAlertIssueKey({ alertname: "PostgresDown" })).toBe("health-alert-PostgresDown");
  });
});

describe("upsertHealthAlertIssue", () => {
  it("opens a health_alert issue, maps critical->error, attributes source, returns the key", async () => {
    const { db, upsert } = mockDb();
    const key = await upsertHealthAlertIssue(db, {
      labels: { alertname: "ContainerErrorLogStorm", service: "sandbox", severity: "critical" },
      annotations: { summary: "storm", description: "flooding" },
      activeAt: "2026-06-15T02:00:00Z",
      sourceSystem: "loki-ruler",
    });

    expect(key).toBe("health-alert-ContainerErrorLogStorm:sandbox");
    const arg = upsert.mock.calls[0][0];
    expect(arg.where.issueKey).toBe(key);
    expect(arg.create.issueType).toBe("health_alert");
    expect(arg.create.severity).toBe("error"); // critical -> error
    expect((arg.create.details as { source: string }).source).toBe("loki-ruler");
    expect(arg.update.resolvedAt).toBeNull(); // re-open semantics on refresh
  });

  it("maps non-critical severity to warn and defaults source to webhook", async () => {
    const { db, upsert } = mockDb();
    await upsertHealthAlertIssue(db, {
      labels: { alertname: "ContainerErrorLogSpike", service: "portal", severity: "warning" },
    });
    const arg = upsert.mock.calls[0][0];
    expect(arg.create.severity).toBe("warn");
    expect((arg.create.details as { source: string }).source).toBe("webhook");
  });
});

describe("resolveHealthAlertIssue", () => {
  it("flips only the open row for the key to resolved", async () => {
    const { db, updateMany } = mockDb();
    await resolveHealthAlertIssue(db, "health-alert-PostgresDown");
    const arg = updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ issueKey: "health-alert-PostgresDown", status: "open" });
    expect(arg.data.status).toBe("resolved");
    expect(arg.data.resolvedAt).toBeInstanceOf(Date);
  });
});
