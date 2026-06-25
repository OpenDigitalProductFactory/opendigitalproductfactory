// EP-SOVEREIGN-SOC P0 — security normalization + scope + enrichment unit tests.
import { describe, expect, it } from "vitest";

import {
  enrichSecurityEvent,
  observableValues,
  type IndicatorMatch,
} from "./enrichment";
import {
  projectInternalSecurityEvents,
  securityCoreFromAuthorizationDecision,
  securityCoreFromToolExecution,
} from "./internal-projector";
import {
  normalizeCefMessage,
  normalizeCloudTrailEvent,
  normalizeWindowsSecurityEvent,
  toSecurityEventWire,
  type NormalizedSecurityCore,
} from "./normalizers";
import { OCSF_CLASS, OCSF_SEVERITY, OCSF_VERSION, cefSeverityToOcsf, syslogSeverityToOcsf } from "./ocsf";
import { ORG_INTERNAL_SCOPE_KEY, deriveSecurityScopeKey } from "./scope";

describe("deriveSecurityScopeKey", () => {
  it("keys on the customer account when present", () => {
    expect(deriveSecurityScopeKey("acct_123", "site_9")).toBe("customer:acct_123");
  });
  it("falls back to the operator's internal scope", () => {
    expect(deriveSecurityScopeKey(null, null)).toBe(ORG_INTERNAL_SCOPE_KEY);
  });
});

describe("OCSF severity mapping", () => {
  it("inverts syslog severity (0 worst) onto OCSF (6 worst)", () => {
    expect(syslogSeverityToOcsf(0)).toBe(OCSF_SEVERITY.FATAL);
    expect(syslogSeverityToOcsf(3)).toBe(OCSF_SEVERITY.HIGH);
    expect(syslogSeverityToOcsf(6)).toBe(OCSF_SEVERITY.INFORMATIONAL);
  });
  it("bands CEF severity (0..10) onto OCSF", () => {
    expect(cefSeverityToOcsf(10)).toBe(OCSF_SEVERITY.CRITICAL);
    expect(cefSeverityToOcsf(8)).toBe(OCSF_SEVERITY.HIGH);
    expect(cefSeverityToOcsf(5)).toBe(OCSF_SEVERITY.MEDIUM);
    expect(cefSeverityToOcsf(0)).toBe(OCSF_SEVERITY.INFORMATIONAL);
  });
});

describe("normalizeWindowsSecurityEvent", () => {
  it("maps a successful logon (4624) to Authentication / Informational", () => {
    const c = normalizeWindowsSecurityEvent({
      eventId: 4624,
      computer: "HOST1",
      timeCreated: "2026-06-24T12:00:00.000Z",
      eventRecordId: 42,
      eventData: { TargetUserName: "alice" },
    });
    expect(c.ocsfClassUid).toBe(OCSF_CLASS.AUTHENTICATION);
    expect(c.severityId).toBe(OCSF_SEVERITY.INFORMATIONAL);
    expect(c.eventKey).toBe("windows.security:HOST1:42");
    expect(c.ocsfVersion).toBe(OCSF_VERSION);
    expect(c.observables).toEqual([{ name: "user.name", type: "User", value: "alice" }]);
  });
  it("escalates a failed logon (4625) to Medium", () => {
    const c = normalizeWindowsSecurityEvent({
      eventId: 4625,
      computer: "HOST1",
      timeCreated: "2026-06-24T12:00:00.000Z",
      eventRecordId: 43,
    });
    expect(c.severityId).toBe(OCSF_SEVERITY.MEDIUM);
  });
  it("maps process creation (4688) to Process Activity", () => {
    const c = normalizeWindowsSecurityEvent({
      eventId: 4688,
      computer: "HOST1",
      timeCreated: "2026-06-24T12:00:00.000Z",
      eventRecordId: 44,
      eventData: { NewProcessName: "C:\\\\Windows\\\\System32\\\\cmd.exe" },
    });
    expect(c.ocsfClassUid).toBe(OCSF_CLASS.PROCESS_ACTIVITY);
    expect(c.observables?.some((o) => o.name === "process.name")).toBe(true);
  });
});

describe("normalizeCloudTrailEvent", () => {
  const base = {
    eventID: "evt-1",
    eventTime: "2026-06-24T12:00:00.000Z",
    eventSource: "s3.amazonaws.com",
    userIdentity: { arn: "arn:aws:iam::1:user/bob", type: "IAMUser" },
  };
  it("maps to API Activity with a CRUD activity id", () => {
    const create = normalizeCloudTrailEvent({ ...base, eventName: "CreateBucket" });
    expect(create.ocsfClassUid).toBe(OCSF_CLASS.API_ACTIVITY);
    expect(create.ocsfActivityId).toBe(1); // Create
    const del = normalizeCloudTrailEvent({ ...base, eventName: "DeleteBucket" });
    expect(del.ocsfActivityId).toBe(4); // Delete
  });
  it("treats an errorCode as a low-severity signal", () => {
    const denied = normalizeCloudTrailEvent({ ...base, eventName: "GetObject", readOnly: true, errorCode: "AccessDenied" });
    expect(denied.severityId).toBe(OCSF_SEVERITY.LOW);
    expect(denied.ocsfActivityId).toBe(2); // Read
  });
});

describe("normalizeCefMessage", () => {
  it("maps to Security Finding with banded severity and a stable eventKey", () => {
    const raw = {
      deviceVendor: "Acme",
      deviceProduct: "FW",
      signatureId: "100",
      name: "port scan",
      severity: 8,
      timestamp: "2026-06-24T12:00:00.000Z",
      extensions: { src: "10.0.0.1", dst: "10.0.0.2", suser: "carol" },
    };
    const a = normalizeCefMessage(raw);
    const b = normalizeCefMessage(raw);
    expect(a.ocsfClassUid).toBe(OCSF_CLASS.SECURITY_FINDING);
    expect(a.severityId).toBe(OCSF_SEVERITY.HIGH);
    expect(a.eventKey).toBe(b.eventKey); // deterministic
    expect(a.observables).toHaveLength(3);
  });
});

describe("toSecurityEventWire", () => {
  it("wraps a core with the discriminator and default confidence", () => {
    const core: NormalizedSecurityCore = {
      eventKey: "k",
      ocsfVersion: OCSF_VERSION,
      ocsfClassUid: 3002,
      time: "2026-06-24T12:00:00.000Z",
      sourceKind: "windows.security",
      sourceName: "HOST1",
    };
    const wire = toSecurityEventWire(core);
    expect(wire.eventType).toBe("security");
    expect(wire.confidence).toBe("source-reported");
  });
});

describe("internal-source projection (self-monitoring)", () => {
  it("maps a denied authorization decision to API Activity / Medium", () => {
    const c = securityCoreFromAuthorizationDecision({
      decisionId: "d1",
      actorType: "agent",
      actorRef: "AGT-1",
      actionKey: "backlog_write",
      objectRef: "BI-1",
      decision: "deny",
      createdAt: new Date("2026-06-24T12:00:00.000Z"),
      routeContext: "/ops",
      sensitivityLevel: "internal",
    });
    expect(c.ocsfClassUid).toBe(OCSF_CLASS.API_ACTIVITY);
    expect(c.severityId).toBe(OCSF_SEVERITY.MEDIUM);
    expect(c.eventKey).toBe("dpf.internal:authz:d1");
    expect(c.actorPrincipalId).toBe("AGT-1");
  });
  it("maps a failed tool execution to Low and a successful one to Informational", () => {
    const fail = securityCoreFromToolExecution({
      id: "t1",
      toolName: "create_backlog_item",
      agentId: "AGT-1",
      userId: null,
      success: false,
      routeContext: "/build",
      createdAt: new Date("2026-06-24T12:00:00.000Z"),
    });
    expect(fail.severityId).toBe(OCSF_SEVERITY.LOW);
    const ok = securityCoreFromToolExecution({
      id: "t2",
      toolName: "search_knowledge",
      agentId: null,
      userId: "u1",
      success: true,
      routeContext: null,
      createdAt: new Date("2026-06-24T12:00:00.000Z"),
    });
    expect(ok.severityId).toBe(OCSF_SEVERITY.INFORMATIONAL);
  });
  it("projects all rows through the injected upsert", async () => {
    const seen: string[] = [];
    const result = await projectInternalSecurityEvents({
      authorizationDecisions: [
        {
          decisionId: "d1",
          actorType: "agent",
          actorRef: "AGT-1",
          actionKey: "x",
          objectRef: "y",
          decision: "allow",
          createdAt: new Date("2026-06-24T12:00:00.000Z"),
          routeContext: null,
          sensitivityLevel: null,
        },
      ],
      toolExecutions: [
        {
          id: "t1",
          toolName: "search_knowledge",
          agentId: null,
          userId: "u1",
          success: true,
          routeContext: null,
          createdAt: new Date("2026-06-24T12:00:00.000Z"),
        },
      ],
      upsert: async (core) => {
        seen.push(core.eventKey);
      },
    });
    expect(result.projected).toBe(2);
    expect(seen).toEqual(["dpf.internal:authz:d1", "dpf.internal:tool:t1"]);
  });
});

describe("enrichSecurityEvent", () => {
  const core: NormalizedSecurityCore = {
    eventKey: "k",
    ocsfVersion: OCSF_VERSION,
    ocsfClassUid: 6003,
    time: "2026-06-24T12:00:00.000Z",
    sourceKind: "aws.cloudtrail",
    sourceName: "s3",
    device: { hostname: "HOST1" },
    observables: [{ name: "src_endpoint.ip", type: "IP Address", value: "1.2.3.4" }],
  };

  it("returns an empty envelope with no lookups", async () => {
    const e = await enrichSecurityEvent(core);
    expect(e.asset).toBeUndefined();
    expect(e.indicators).toEqual([]);
  });

  it("extracts observable values and applies injected lookups", async () => {
    expect(observableValues(core)).toEqual(["1.2.3.4"]);
    const match: IndicatorMatch = { indicatorType: "ip", value: "1.2.3.4", source: "feed" };
    const e = await enrichSecurityEvent(core, {
      lookupAsset: async (key) => (key === "HOST1" ? { name: "HOST1", criticality: "high" } : null),
      matchIndicators: async (values) => (values.includes("1.2.3.4") ? [match] : []),
    });
    expect(e.asset?.criticality).toBe("high");
    expect(e.indicators).toEqual([match]);
  });
});
