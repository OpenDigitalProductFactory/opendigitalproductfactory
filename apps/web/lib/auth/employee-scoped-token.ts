// Employee-scoped MCP credential issuance (BI-HDLEMP-03, EP-HEADLESS-EMPLOYEE).
//
// v1 auth for the "headless employee" session (founder decision, employee-scoped
// PAT): let an organization point its own agent at /api/mcp/v1 acting AS a
// specific employee. The token authenticates as the employee's User (the
// accountable identity + authorization scope) while its agentId records which
// agent is acting — the dual-principal shape the Pseudo-User Contract ratifies.
//
// This is DELEGATION, not impersonation:
//   - subject = the employee's backing User (accountable; carries the role caps)
//   - actor   = the org agent (agentId; carries the agent grants)
// Both are persisted on the McpApiToken row and travel through the existing
// authorization pipeline unchanged: authority resolves to
//   (employee-User role capabilities) ∩ (agent grants) ∩ (token scope).
// So this module adds a *binding + validation* layer over the trusted
// issueMcpApiToken primitive — it introduces no new credential crypto or storage.
//
// Two load-bearing safety properties enforced here:
//   1. An employee-scoped token REQUIRES a backing User. EmployeeProfile.userId
//      is optional (many employees have no User), so issuance MUST fail loudly
//      rather than mint an unbound credential.
//   2. It REQUIRES an agentId (the acting agent). Without it the token would be
//      a bare "act as this human" credential — the impersonation the contract
//      forbids. Requiring the actor keeps every issued token a delegated one.

import {
  issueMcpApiToken,
  type IssueMcpTokenResult,
  type McpTokenScope,
} from "@/lib/auth/mcp-api-token";

/** Narrow structural client — satisfied by the real PrismaClient and test fakes. */
export interface EmployeeTokenSubjectClient {
  employeeProfile: {
    findUnique: (args: unknown) => Promise<{
      userId?: string | null;
      displayName?: string | null;
      status?: string | null;
    } | null>;
  };
}

export type EmployeeTokenSubject = {
  employeeId: string;
  /** The backing User id — the accountable identity the token authenticates as. */
  userId: string;
  displayName: string | null;
  status: string | null;
};

export type ResolveEmployeeSubjectResult =
  | { ok: true; subject: EmployeeTokenSubject }
  | { ok: false; error: "employee_not_found" | "no_user_backing"; message: string };

/**
 * Resolve an employee to the User that backs it — the accountable subject an
 * employee-scoped token authenticates as. Fails loudly when the employee has no
 * User (EmployeeProfile.userId is nullable): an unbound credential must never be
 * issued. Pure aside from one keyed read; injectable for tests.
 */
export async function resolveEmployeeTokenSubject(
  db: EmployeeTokenSubjectClient,
  employeeId: string,
): Promise<ResolveEmployeeSubjectResult> {
  const trimmed = employeeId?.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: "employee_not_found",
      message: "employeeId is required",
    };
  }
  const row = await db.employeeProfile.findUnique({
    where: { id: trimmed },
    select: { userId: true, displayName: true, status: true },
  });
  if (!row) {
    return {
      ok: false,
      error: "employee_not_found",
      message: `no employee found for id ${trimmed}`,
    };
  }
  const userId = row.userId?.trim() || null;
  if (!userId) {
    return {
      ok: false,
      error: "no_user_backing",
      message:
        `employee ${trimmed} has no backing User account, so no employee-scoped ` +
        `token can be issued — the token must authenticate as an accountable User. ` +
        `Provision a User for this employee first.`,
    };
  }
  return {
    ok: true,
    subject: {
      employeeId: trimmed,
      userId,
      displayName: row.displayName ?? null,
      status: row.status ?? null,
    },
  };
}

export type IssueEmployeeScopedTokenInput = {
  employeeId: string;
  /** The acting org agent. REQUIRED — this is what makes the token delegated. */
  agentId: string;
  name: string;
  scope?: McpTokenScope;
  scopes: string[];
  expiresInDays: number | null;
};

export type IssueEmployeeScopedTokenResult =
  | (Extract<IssueMcpTokenResult, { ok: true }> & {
      employeeId: string;
      userId: string;
      agentId: string;
    })
  | { ok: false; error: "employee_not_found" | "no_user_backing" | "missing_agent"; message: string }
  | Extract<IssueMcpTokenResult, { ok: false }>;

/**
 * Issue an MCP PAT bound to a specific employee's User (subject) + an acting org
 * agent (actor). Composes {@link resolveEmployeeTokenSubject} with the trusted
 * {@link issueMcpApiToken} primitive; the `issue` dependency is injectable for
 * tests. Enforces both safety properties (backing User required; agent required)
 * before any credential is minted.
 */
export async function issueEmployeeScopedMcpToken(
  input: IssueEmployeeScopedTokenInput,
  deps: {
    db: EmployeeTokenSubjectClient;
    issue?: typeof issueMcpApiToken;
  },
): Promise<IssueEmployeeScopedTokenResult> {
  const agentId = input.agentId?.trim();
  if (!agentId) {
    return {
      ok: false,
      error: "missing_agent",
      message:
        "agentId (the acting agent) is required — an employee-scoped token is a " +
        "delegated credential (subject=employee, actor=agent), never a bare " +
        "act-as-human token.",
    };
  }

  const resolved = await resolveEmployeeTokenSubject(deps.db, input.employeeId);
  if (!resolved.ok) return resolved;

  const issue = deps.issue ?? issueMcpApiToken;
  const result = await issue({
    userId: resolved.subject.userId,
    agentId,
    name: input.name,
    scope: input.scope,
    scopes: input.scopes,
    expiresInDays: input.expiresInDays,
    kind: "operator",
  });

  if (!result.ok) return result;
  return {
    ...result,
    employeeId: resolved.subject.employeeId,
    userId: resolved.subject.userId,
    agentId,
  };
}
