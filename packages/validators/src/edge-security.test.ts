// EP-SOVEREIGN-SOC P0 — security wire schema + envelope union routing.
import { describe, expect, it } from "vitest";

import { edgeEventEnvelopeSchema, securityEventWireSchema } from "./edge";

const ISO = "2026-06-24T12:00:00.000Z";
const UUID = "11111111-1111-4111-8111-111111111111";

const validSecurity = {
  eventType: "security" as const,
  eventKey: "windows.security:HOST1:42",
  ocsfVersion: "1.8.0",
  ocsfClassUid: 3002,
  severityId: 3,
  time: ISO,
  sourceKind: "windows.security",
  sourceName: "HOST1",
};

describe("securityEventWireSchema", () => {
  it("parses a minimal valid security event and defaults confidence", () => {
    const r = securityEventWireSchema.parse(validSecurity);
    expect(r.eventType).toBe("security");
    expect(r.confidence).toBe("source-reported");
  });

  it("rejects a missing eventKey", () => {
    const { eventKey: _omit, ...rest } = validSecurity;
    expect(securityEventWireSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects severityId outside the OCSF 0..6 range", () => {
    expect(
      securityEventWireSchema.safeParse({ ...validSecurity, severityId: 7 })
        .success,
    ).toBe(false);
  });
});

describe("edgeEventEnvelopeSchema union routing", () => {
  it("accepts a mixed alert + security batch and preserves the discriminator", () => {
    const env = {
      runKey: UUID,
      observedAt: ISO,
      eventsVersion: "1" as const,
      events: [
        {
          dedupKey: "if-down:sw1:gi1",
          source: "snmp.trap",
          severity: "warn" as const,
          action: "trigger" as const,
          summary: "interface down",
          occurredAt: ISO,
        },
        validSecurity,
      ],
    };
    const r = edgeEventEnvelopeSchema.parse(env);
    expect(r.events).toHaveLength(2);
    // bare edge event defaults to "alert"; the OCSF event routes to "security"
    expect(r.events[0].eventType).toBe("alert");
    expect(r.events[1].eventType).toBe("security");
  });

  it("rejects a security event missing OCSF required fields", () => {
    const env = {
      runKey: UUID,
      observedAt: ISO,
      eventsVersion: "1" as const,
      events: [{ eventType: "security", eventKey: "x", time: ISO }],
    };
    expect(edgeEventEnvelopeSchema.safeParse(env).success).toBe(false);
  });
});
