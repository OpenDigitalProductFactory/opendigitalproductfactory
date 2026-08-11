import { describe, it, expect, vi } from "vitest";
import {
  resolveEmployeeTokenSubject,
  issueEmployeeScopedMcpToken,
  type EmployeeTokenSubjectClient,
} from "./employee-scoped-token";
import type { IssueMcpTokenResult, IssueMcpTokenInput } from "@/lib/auth/mcp-api-token";

function mockDb(row: {
  userId?: string | null;
  displayName?: string | null;
  status?: string | null;
} | null): EmployeeTokenSubjectClient {
  return {
    employeeProfile: { findUnique: vi.fn(async () => row) },
  } as unknown as EmployeeTokenSubjectClient;
}

const OK_ISSUE: Extract<IssueMcpTokenResult, { ok: true }> = {
  ok: true,
  tokenId: "TOK-1",
  plaintext: "test-plaintext-not-a-real-secret",
  prefix: "dpfmcp",
  tokenSuffix: "xxxx",
  expiresAt: null,
};

describe("resolveEmployeeTokenSubject (BI-HDLEMP-03)", () => {
  it("resolves an employee that has a backing User", async () => {
    const res = await resolveEmployeeTokenSubject(
      mockDb({ userId: "USER-9", displayName: "Ada Lovelace", status: "active" }),
      "EMP-1",
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.subject).toEqual({
        employeeId: "EMP-1",
        userId: "USER-9",
        displayName: "Ada Lovelace",
        status: "active",
      });
    }
  });

  it("fails with employee_not_found when the employee does not exist", async () => {
    const res = await resolveEmployeeTokenSubject(mockDb(null), "EMP-x");
    expect(res).toMatchObject({ ok: false, error: "employee_not_found" });
  });

  it("fails with employee_not_found for an empty id (no DB read implied)", async () => {
    const res = await resolveEmployeeTokenSubject(mockDb(null), "   ");
    expect(res).toMatchObject({ ok: false, error: "employee_not_found" });
  });

  it("fails with no_user_backing when the employee has no User (the nullable gap)", async () => {
    const res = await resolveEmployeeTokenSubject(
      mockDb({ userId: null, displayName: "No Login", status: "onboarding" }),
      "EMP-2",
    );
    expect(res).toMatchObject({ ok: false, error: "no_user_backing" });
  });
});

describe("issueEmployeeScopedMcpToken (BI-HDLEMP-03)", () => {
  it("issues a token bound to the employee's User + acting agent (delegation)", async () => {
    const issue = vi.fn(async (_input: IssueMcpTokenInput) => OK_ISSUE);
    const res = await issueEmployeeScopedMcpToken(
      {
        employeeId: "EMP-1",
        agentId: "org-agent",
        name: "Acme HR agent",
        scope: "write",
        scopes: ["work_capsule_read"],
        expiresInDays: 30,
      },
      { db: mockDb({ userId: "USER-9", displayName: "Ada", status: "active" }), issue },
    );
    expect(res.ok).toBe(true);
    // Subject = employee's User, actor = the agent.
    expect(issue).toHaveBeenCalledOnce();
    expect(issue.mock.calls[0][0]).toMatchObject({
      userId: "USER-9",
      agentId: "org-agent",
      scope: "write",
      scopes: ["work_capsule_read"],
      expiresInDays: 30,
      kind: "operator",
    });
    if (res.ok) {
      expect(res).toMatchObject({ employeeId: "EMP-1", userId: "USER-9", agentId: "org-agent" });
    }
  });

  it("refuses to mint a credential without an acting agent (no bare impersonation)", async () => {
    const issue = vi.fn(async (_input: IssueMcpTokenInput) => OK_ISSUE);
    const res = await issueEmployeeScopedMcpToken(
      { employeeId: "EMP-1", agentId: "  ", name: "x", scopes: ["s"], expiresInDays: null },
      { db: mockDb({ userId: "USER-9" }), issue },
    );
    expect(res).toMatchObject({ ok: false, error: "missing_agent" });
    expect(issue).not.toHaveBeenCalled(); // nothing minted
  });

  it("refuses to mint a credential for an employee with no backing User", async () => {
    const issue = vi.fn(async (_input: IssueMcpTokenInput) => OK_ISSUE);
    const res = await issueEmployeeScopedMcpToken(
      { employeeId: "EMP-2", agentId: "org-agent", name: "x", scopes: ["s"], expiresInDays: null },
      { db: mockDb({ userId: null }), issue },
    );
    expect(res).toMatchObject({ ok: false, error: "no_user_backing" });
    expect(issue).not.toHaveBeenCalled(); // nothing minted
  });

  it("propagates a failure from the underlying issue primitive", async () => {
    const issue = vi.fn(async () => ({
      ok: false as const,
      error: "empty_scopes" as const,
      message: "at least one scope is required",
    }));
    const res = await issueEmployeeScopedMcpToken(
      { employeeId: "EMP-1", agentId: "org-agent", name: "x", scopes: [], expiresInDays: null },
      { db: mockDb({ userId: "USER-9" }), issue },
    );
    expect(res).toMatchObject({ ok: false, error: "empty_scopes" });
  });
});
