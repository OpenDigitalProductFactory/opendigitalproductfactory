// Edge Node failure-audit writer.
//
// AGENTS.md §8 ("Every tool call writes to ToolExecution") + the Edge
// Node spec's "REST ingestion controls (Phase 0)" Failure audit
// requirement: every authenticated REST request — success or failure —
// records a ToolExecution row. The minimum audit surface:
//
//   - 401 / 403 / 429 / 5xx: log edgeNodeId (if resolved), failing
//     scope, reason code; never log the bearer plaintext.
//   - 200 / 201 / 202: log success summary (counts, status).
//
// This module owns the audit-row shape for the three Edge Node routes
// (/api/v1/edge/enroll, /heartbeat, /discovery-runs) and the contract
// that audit writes never throw — a failed audit log is a console
// error, not a 5xx returned to the Edge Node binary.

import { prisma } from "@dpf/db";

/**
 * Sentinel userId for Edge Node calls. Edge Nodes are unattended
 * machine principals (per the Edge Node spec § Edge Node vs Mobile
 * Device), not user-bound. The ToolExecution.userId column is
 * required, so we use a constant value to mark machine-principal
 * audit rows. The actual identity lives in parameters.edgeNodeId /
 * .nodeId / .principalId — those are queryable via Prisma's Json
 * filters.
 */
export const EDGE_NODE_AUDIT_USER_ID = "system:edge-node";

/**
 * Sentinel agentId used when auth resolution failed (pre-auth
 * errors like missing_authorization). Post-auth calls fill in the
 * resolved EdgeNode's principalId for richer audit trails.
 */
export const EDGE_NODE_AUDIT_AGENT_UNKNOWN = "edge-node:unknown";

/**
 * `executionMode` value identifying audit rows that originated from
 * the REST Edge Node transport. Distinct from the MCP transport's
 * values so a query can pull "all Edge Node REST traffic" with a
 * single filter.
 */
export const EDGE_NODE_AUDIT_EXECUTION_MODE = "edge-rest";

export type EdgeAuditRoute =
  | "edge.enroll"
  | "edge.heartbeat"
  | "edge.discovery_runs.submit"
  | "edge.federation_candidates.submit"
  | "edge.adapters";

export type EdgeAuditInput = {
  /** Logical tool name; doubles as the toolName column. */
  route: EdgeAuditRoute;
  /** HTTP route the request hit, e.g. "/api/v1/edge/heartbeat". */
  routeContext: string;
  /** Date.now() at request entry — used to compute durationMs. */
  startedAt: number;
  /** EdgeNode.id (cuid surrogate) when resolveEdgeNodeAuth succeeded. */
  edgeNodeId: string | null;
  /** EdgeNode.nodeId (stable external id) when auth succeeded. */
  nodeId: string | null;
  /** Principal.id of the Edge Node (post-Principal-convergence). */
  principalId: string | null;
  /** HTTP status code returned to the client. */
  status: number;
  /** True when the response carried `ok: true`. */
  success: boolean;
  /**
   * Error reason code from the route (e.g. "missing_authorization",
   * "stale_observation"). Undefined for success responses.
   */
  error?: string;
  /**
   * Route-specific structured summary. Item counts, replay markers,
   * etc. NEVER include the bearer plaintext or the request body
   * raw — see redaction rules in the route handlers.
   */
  summary?: Record<string, unknown>;
};

// Test override (set via setToolExecutionCreateOverride in tests so
// we don't need to mock the entire prisma client). Default null.
let _toolExecutionCreateOverride:
  | ((data: Record<string, unknown>) => Promise<{ id: string } | unknown>)
  | null = null;

/**
 * Test-only: replace the underlying prisma.toolExecution.create call.
 * Resets to default behavior when passed null.
 */
export function setToolExecutionCreateOverride(
  override:
    | ((data: Record<string, unknown>) => Promise<{ id: string } | unknown>)
    | null,
): void {
  _toolExecutionCreateOverride = override;
}

/**
 * Write a ToolExecution row describing an Edge Node REST request.
 * Never throws — a failed audit becomes a console.error, not a 5xx
 * returned to the caller. This matches mcp-governed-execute.ts:writeAudit
 * which has the same contract for the same reason.
 */
export async function writeEdgeNodeAudit(input: EdgeAuditInput): Promise<void> {
  const durationMs = Math.max(0, Date.now() - input.startedAt);

  const row = {
    threadId: "", // Edge Node calls are not chat-threaded
    agentId: input.principalId ?? EDGE_NODE_AUDIT_AGENT_UNKNOWN,
    userId: EDGE_NODE_AUDIT_USER_ID,
    toolName: input.route,
    parameters: {
      edgeNodeId: input.edgeNodeId,
      nodeId: input.nodeId,
      principalId: input.principalId,
      summary: input.summary ?? {},
    } as object,
    result: {
      ok: input.success,
      status: input.status,
      ...(input.error !== undefined ? { error: input.error } : {}),
    } as object,
    success: input.success,
    executionMode: EDGE_NODE_AUDIT_EXECUTION_MODE,
    routeContext: input.routeContext,
    durationMs,
    summary: buildShortSummary(input),
  };

  try {
    if (_toolExecutionCreateOverride) {
      await _toolExecutionCreateOverride(row);
      return;
    }
    await prisma.toolExecution.create({ data: row, select: { id: true } });
  } catch (err) {
    // Audit MUST NOT mask the underlying request success/failure.
    // Log enough context to investigate without throwing.
    console.error(
      `[edge-audit] write failed route=${input.route} status=${input.status} nodeId=${input.nodeId ?? "?"}:`,
      err,
    );
  }
}

/**
 * Compose a one-line summary suitable for the ToolExecution.summary
 * column. Aggregated in the operator UI without expanding the JSON
 * payload, so brief is the point.
 */
function buildShortSummary(input: EdgeAuditInput): string {
  const id = input.nodeId ?? "unauthed";
  const errorPart = input.error ? ` error=${input.error}` : "";
  return `${input.route} status=${input.status} node=${id}${errorPart}`;
}
