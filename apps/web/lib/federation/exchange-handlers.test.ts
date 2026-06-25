import { describe, expect, it, vi } from "vitest";
import { buildRemediationProposal } from "@/lib/service-desk/remediation-authority";
import {
  federatedTicketId,
  handleIncomingIncident,
  handleIncomingProposal,
  type IncidentExchangeDb,
  type IncomingIncident,
  type ProposalExchangeDb,
} from "./exchange-handlers";

const incident: IncomingIncident = {
  incidentKey: "edge-incident|peer-node|deploy|t",
  summary: "3 alerts after deploy",
  highestSeverity: "critical",
  alertCount: 3,
  payloadHash: "h1",
};

function incidentDb(existing: { version: number; syncStatus: string; payloadHash?: string | null } | null) {
  const mirrorUpsert = vi.fn().mockResolvedValue({});
  const ticketUpsert = vi.fn().mockResolvedValue({});
  const db = {
    federatedRecordMirror: { findFirst: vi.fn().mockResolvedValue(existing), upsert: mirrorUpsert },
    serviceTicket: { upsert: ticketUpsert },
  } as unknown as IncidentExchangeDb;
  return { db, mirrorUpsert, ticketUpsert };
}

describe("federatedTicketId", () => {
  it("is deterministic, link-scoped, ST-FED-prefixed", () => {
    const a = federatedTicketId("link_1", incident.incidentKey);
    expect(a).toBe(federatedTicketId("link_1", incident.incidentKey));
    expect(a).not.toBe(federatedTicketId("link_2", incident.incidentKey));
    expect(a).toMatch(/^ST-FED-[0-9A-F]{8}$/);
  });
});

describe("handleIncomingIncident (B3 mirror)", () => {
  it("creates a ticket + mirror for a new federated incident", async () => {
    const { db, mirrorUpsert, ticketUpsert } = incidentDb(null);
    const res = await handleIncomingIncident(db, "link_1", incident);
    expect(res.action).toBe("created");
    const ticket = (ticketUpsert.mock.calls[0][0] as { create: Record<string, unknown> }).create;
    expect(ticket.ticketKind).toBe("incident");
    expect(ticket.priority).toBe("urgent"); // critical
    expect(ticket.correlatedIncidentKey).toBe(incident.incidentKey);
    expect(mirrorUpsert).toHaveBeenCalledOnce();
  });

  it("noops when the same payload arrives again (idempotent)", async () => {
    const { db, mirrorUpsert, ticketUpsert } = incidentDb({ version: 1, syncStatus: "synced", payloadHash: "h1" });
    const res = await handleIncomingIncident(db, "link_1", incident);
    expect(res.action).toBe("noop");
    expect(ticketUpsert).not.toHaveBeenCalled();
    expect(mirrorUpsert).not.toHaveBeenCalled();
  });

  it("updates on a new payload based on the current version", async () => {
    const { db } = incidentDb({ version: 1, syncStatus: "synced", payloadHash: "h0" });
    const res = await handleIncomingIncident(db, "link_1", { ...incident, payloadHash: "h2", baseVersion: 1 });
    expect(res.action).toBe("updated");
  });

  it("flags a conflict on a stale base version", async () => {
    const { db, ticketUpsert } = incidentDb({ version: 3, syncStatus: "synced", payloadHash: "h0" });
    const res = await handleIncomingIncident(db, "link_1", { ...incident, payloadHash: "h2", baseVersion: 1 });
    expect(res.action).toBe("conflict");
    expect(ticketUpsert).not.toHaveBeenCalled();
  });
});

describe("handleIncomingProposal (B4 consent gate)", () => {
  function proposalDb() {
    const create = vi.fn().mockResolvedValue({ proposalId: "x" });
    const db = { federatedRemediationProposal: { create } } as unknown as ProposalExchangeDb;
    return { db, create };
  }
  function draft(risk: "read-only" | "medium" | "destructive") {
    return buildRemediationProposal({ incidentKey: "k", edgeNodeId: "n", boundaryRef: "link_1" }, [
      { actionType: "act", parameters: {}, riskClass: risk, rationale: "r" },
    ]);
  }

  it("rejects a band-refused proposal", async () => {
    const { db } = proposalDb();
    const res = await handleIncomingProposal(db, "link_1", draft("destructive"));
    expect(res.landing).toBe("refused");
    expect(res.status).toBe("rejected");
  });

  it("routes a mutating proposal to the customer Attention Surface (proposed)", async () => {
    const { db, create } = proposalDb();
    const res = await handleIncomingProposal(db, "link_1", draft("medium"));
    expect(res.landing).toBe("customer-attention-surface");
    expect(res.status).toBe("proposed");
    expect((create.mock.calls[0][0] as { data: { status: string } }).data.status).toBe("proposed");
  });

  it("auto-executes a read-only proposal only when the customer opts in", async () => {
    const { db } = proposalDb();
    expect((await handleIncomingProposal(db, "link_1", draft("read-only"), { customerAllowsAuto: true })).landing).toBe(
      "auto-execute-on-customer",
    );
    expect((await handleIncomingProposal(db, "link_1", draft("read-only"), { customerAllowsAuto: false })).landing).toBe(
      "customer-attention-surface",
    );
  });
});
