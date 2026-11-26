import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, authenticateRequest } = vi.hoisted(() => ({ findMany: vi.fn(), authenticateRequest: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { authorizationDecisionLog: { findMany } } }));
vi.mock("@/lib/api/auth-middleware", () => ({ authenticateRequest }));

import { GET } from "./route";

// BI-9F7192F9 phase 3 (AC-E8): the governance decisions API lists an actor's
// own S5 rehearsal requester audit rows unchanged; the rows hold references only.
describe("GET /api/v1/governance/decisions with S5 rehearsal requester audit rows", () => {
  const auditRow = {
    id: "row-1", decisionId: `s5rr:retire:${"c".repeat(64)}`, actorType: "human", actorRef: "owner-user",
    actionKey: "s5.rehearsal-requester.retire", objectRef: "requester-user", decision: "allow",
    rationale: { schema: "s5-rehearsal-requester-audit.v1", command: "retire", retirementReason: "rehearsal_complete" },
    createdAt: new Date("2026-11-26T12:00:00Z"),
  };

  beforeEach(() => {
    findMany.mockReset();
    authenticateRequest.mockReset();
  });

  it("scopes the listing to the authenticated actor and returns the audit row as stored", async () => {
    authenticateRequest.mockResolvedValue({ user: { id: "owner-user" } });
    findMany.mockResolvedValue([auditRow]);
    const response = await GET(new Request("https://dpf.test/api/v1/governance/decisions"));
    expect(response.status).toBe(200);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { actorRef: "owner-user" } }));
    const body = JSON.stringify(await response.json());
    expect(body).toContain("s5.rehearsal-requester.retire");
    for (const secret of ["password", "passwordHash", "tokenHash"]) expect(body).not.toContain(secret);
  });
});
