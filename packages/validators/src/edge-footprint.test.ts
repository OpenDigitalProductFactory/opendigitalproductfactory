// BI-4B381171 — FP7 (bounded payloads/cardinality) contract test.
//
// The edge-footprint spec (docs/superpowers/specs/
// 2026-06-19-edge-node-deployment-topology-and-remote-provisioning-design.md
// §6, §11.2) requires per-node batch/payload caps to be enforced BEFORE
// data hits Postgres/Neo4j/Prometheus/Grafana. This file locks in the two
// array-cardinality caps that live in the wire-contract schemas
// themselves (the earliest possible enforcement point — before the 64 KB
// body-size cap on /api/v1/edge/metrics and /api/v1/edge/events even
// gets a chance to reject an oversized request).
//
// It intentionally does NOT assert queue-depth, retry-horizon, or
// Prometheus label-cardinality caps: those are not implemented anywhere
// in the edge ingestion path today (confirmed by repo-wide search — no
// edge-scoped Prometheus metrics are registered at all, so there is
// nothing yet to bound). Asserting a passing test for code that doesn't
// exist would be a false-green; the gap is called out in the
// BI-4B381171 PR body and tracked as a follow-up instead.
import { describe, expect, it } from "vitest";

import { edgeEventEnvelopeSchema, metricsEnvelopeSchema } from "./edge";

const ISO = "2026-06-24T12:00:00.000Z";
const UUID = "11111111-1111-4111-8111-111111111111";

function interfaceMetric(n: number) {
  return {
    deviceKey: `snmp:10.0.0.${n % 255}`,
    ifName: `eth${n}`,
    rxBps: 0,
    txBps: 0,
    operStatus: "up" as const,
  };
}

describe("metricsEnvelopeSchema — FP7 interface-array cap", () => {
  const base = {
    runKey: UUID,
    observedAt: ISO,
    metricsVersion: "1" as const,
  };

  it("accepts an envelope at the 2000-interface cap", () => {
    const interfaces = Array.from({ length: 2000 }, (_, i) => interfaceMetric(i));
    const result = metricsEnvelopeSchema.safeParse({ ...base, interfaces });
    expect(result.success).toBe(true);
  });

  it("rejects an envelope over the 2000-interface cap", () => {
    const interfaces = Array.from({ length: 2001 }, (_, i) => interfaceMetric(i));
    const result = metricsEnvelopeSchema.safeParse({ ...base, interfaces });
    expect(result.success).toBe(false);
  });
});

describe("edgeEventEnvelopeSchema — FP7 event-array cap", () => {
  const baseEvent = {
    eventType: "alert" as const,
    dedupKey: "test.alert:host1",
    source: "test",
    severity: "info" as const,
    action: "trigger" as const,
    summary: "test alert",
    occurredAt: ISO,
  };
  const base = {
    runKey: UUID,
    observedAt: ISO,
    eventsVersion: "1" as const,
  };

  it("accepts an envelope at the 500-event cap", () => {
    const events = Array.from({ length: 500 }, () => ({ ...baseEvent }));
    const result = edgeEventEnvelopeSchema.safeParse({ ...base, events });
    expect(result.success).toBe(true);
  });

  it("rejects an envelope over the 500-event cap", () => {
    const events = Array.from({ length: 501 }, () => ({ ...baseEvent }));
    const result = edgeEventEnvelopeSchema.safeParse({ ...base, events });
    expect(result.success).toBe(false);
  });
});
