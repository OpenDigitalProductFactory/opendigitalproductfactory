import { describe, expect, it } from "vitest";
import {
  isValidTicketStatusTransition,
  priorityFromSeverity,
  SERVICE_TICKET_KINDS,
  SERVICE_TICKET_STATUSES,
  serviceTicketDraftFromIncident,
  type IncidentLike,
} from "./service-ticket-types";

describe("service-ticket unions (A3 / BI-99FEA7FA)", () => {
  it("uses hyphenated status values (WS-0 convergence rule, no underscores)", () => {
    for (const s of SERVICE_TICKET_STATUSES) expect(s).not.toContain("_");
    expect(SERVICE_TICKET_STATUSES).toContain("in-progress");
    expect(SERVICE_TICKET_STATUSES).toContain("waiting-customer");
  });

  it("models one ticket with four kinds", () => {
    expect(SERVICE_TICKET_KINDS).toEqual(["incident", "request", "change", "scheduled-review"]);
  });
});

describe("isValidTicketStatusTransition", () => {
  it("allows forward progress and re-open from resolved", () => {
    expect(isValidTicketStatusTransition("open", "in-progress")).toBe(true);
    expect(isValidTicketStatusTransition("resolved", "in-progress")).toBe(true); // re-open
    expect(isValidTicketStatusTransition("open", "open")).toBe(true);
  });

  it("treats closed as terminal and rejects backward jumps", () => {
    expect(isValidTicketStatusTransition("closed", "open")).toBe(false);
    expect(isValidTicketStatusTransition("in-progress", "open")).toBe(false);
  });
});

describe("priorityFromSeverity", () => {
  it("maps edge severity to ticket priority", () => {
    expect(priorityFromSeverity("critical")).toBe("urgent");
    expect(priorityFromSeverity("error")).toBe("high");
    expect(priorityFromSeverity("warn")).toBe("normal");
    expect(priorityFromSeverity("info")).toBe("low");
    expect(priorityFromSeverity(null)).toBe("low");
  });
});

describe("serviceTicketDraftFromIncident", () => {
  const incident: IncidentLike = {
    incidentKey: "edge-incident|node_1|deploy-abc|2026-06-24T02:31:00.000Z",
    edgeNodeId: "node_1",
    summary: "3 alerts after git.deploy change \"ship v2\"",
    highestSeverity: "critical",
    alertCount: 3,
    onsetAt: new Date("2026-06-24T02:31:00Z"),
    triggeringChange: { changeKey: "deploy-abc", source: "git.deploy", summary: "ship v2" },
  };

  it("maps a correlated incident to an incident ticket draft, one per incident", () => {
    const draft = serviceTicketDraftFromIncident(incident, {
      customerAccountId: "acc_a",
      customerSiteId: "s1",
      scopeKey: "customer:acc_a:site:s1",
    });
    expect(draft.ticketKind).toBe("incident");
    expect(draft.status).toBe("open");
    expect(draft.priority).toBe("urgent");
    expect(draft.severity).toBe("critical");
    expect(draft.correlatedIncidentKey).toBe(incident.incidentKey);
    expect(draft.customerAccountId).toBe("acc_a");
    expect(draft.scopeKey).toBe("customer:acc_a:site:s1");
    expect(draft.description).toContain("deploy-abc");
  });

  it("defaults scope to organization-internal when no customer", () => {
    const draft = serviceTicketDraftFromIncident({ ...incident, triggeringChange: null });
    expect(draft.scopeKey).toBe("organization:internal");
    expect(draft.description).toBe(incident.summary);
  });
});
