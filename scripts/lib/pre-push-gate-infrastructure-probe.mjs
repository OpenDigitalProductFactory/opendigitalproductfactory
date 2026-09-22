// scripts/lib/pre-push-gate-infrastructure-probe.mjs — the evidence behind the
// `gate-infrastructure-unavailable` pre-push override (BI-02E5F2A1, design
// fixed by DI-FC5699629694).
//
// The pre-push gate accepts that code ONLY when it can itself capture machine
// evidence that the gate's infrastructure failed. The evidence is a re-attempt
// of the same MCP call the gate opens with — `claim_nonprod_environment_lease`
// on the local-integration-ci pool — and the failure response it produced: an
// HTTP 401 `unauthorized: invalid or expired token`, a refused connection, a
// server error. Prose in the reason is never evidence.
//
// The probe is deliberately asymmetric:
//   - claim FAILS for an infrastructure reason → evidence, override may proceed;
//     the record it produces is gate-UNRUN, never a pass (cloud CI stays the net)
//   - claim SUCCEEDS (admitted, queued or reused) → the gate could run, so the
//     probe releases what it claimed and REFUSES the override
//   - claim is refused by a healthy server for a non-infrastructure reason, or
//     no credential is configured at all → not infrastructure evidence, refused
//
// Per push, nothing persists beyond the gate record the hook writes.

import { mcpCall } from "./mcp-client.mjs";
import { resolveMcpCredential } from "./mcp-credential.mjs";
import { resolveAgentIdentity } from "./agent-identity.mjs";
import {
  GATE_INFRASTRUCTURE_FAILURE_KINDS,
  GATE_INFRASTRUCTURE_UNAVAILABLE_CODE,
} from "../../packages/dpf-skill-pack/hooks/lib/local-ci-override.mjs";

export { GATE_INFRASTRUCTURE_FAILURE_KINDS, GATE_INFRASTRUCTURE_UNAVAILABLE_CODE };

export const PROBE_TOOL = "claim_nonprod_environment_lease";
export const PROBE_RELEASE_TOOL = "release_nonprod_environment_lease";

const MAX_MESSAGE_CHARS = 500;

const TRANSPORT_RE =
  /ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|EAI_AGAIN|EPIPE|socket hang up|timed out after|fetch failed|injected transport exited/i;
const AUTH_RE =
  /unauthorized|forbidden|invalid or expired token|invalid_client|invalid_token|insufficient_token_scope|insufficient_scope|token exchange|status 401|status 403|\b401\b|\b403\b/i;
const SERVER_ERROR_RE = /invalid JSON response|status 5\d\d|internal error|-32603/i;

function truncate(text) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  return value.length > MAX_MESSAGE_CHARS ? `${value.slice(0, MAX_MESSAGE_CHARS - 1)}…` : value;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Classify what the re-attempted lease claim did.
 *
 * Pure: takes either the error `mcpCall` threw or the payload it resolved to.
 *
 * @param {{ error?: unknown, response?: unknown }} input
 * @returns {{ infrastructureUnavailable: true, kind: string, message: string, statusCode?: number }
 *   | { infrastructureUnavailable: false, outcome: "claim-succeeded" | "claim-refused" | "unclassified", message: string, leaseId?: string, admissionStatus?: string }}
 */
export function classifyLeaseProbeOutcome({ error, response } = {}) {
  if (error !== undefined && error !== null) {
    const message = truncate(errorMessage(error));
    if (TRANSPORT_RE.test(message)) {
      return { infrastructureUnavailable: true, kind: "transport-unreachable", message };
    }
    if (AUTH_RE.test(message)) {
      return { infrastructureUnavailable: true, kind: "credential-rejected", message };
    }
    if (SERVER_ERROR_RE.test(message)) {
      return { infrastructureUnavailable: true, kind: "server-error", message };
    }
    return { infrastructureUnavailable: false, outcome: "unclassified", message };
  }

  // A JSON-RPC error envelope (no `result`): the transport-auth layer answers
  // 401 with { jsonrpc, id: null, error: { code, message: "unauthorized: …" } },
  // which mcp-client's extractToolResult hands back verbatim.
  const rpcError = response && typeof response === "object" && response.error && typeof response.error === "object"
    ? response.error
    : null;
  if (rpcError) {
    const message = truncate(rpcError.message ?? JSON.stringify(rpcError));
    if (AUTH_RE.test(message)) {
      return { infrastructureUnavailable: true, kind: "credential-rejected", message, statusCode: 401 };
    }
    if (SERVER_ERROR_RE.test(message) || SERVER_ERROR_RE.test(String(rpcError.code))) {
      return { infrastructureUnavailable: true, kind: "server-error", message };
    }
    return { infrastructureUnavailable: false, outcome: "claim-refused", message };
  }

  if (response && typeof response === "object" && response.success === true) {
    return {
      infrastructureUnavailable: false,
      outcome: "claim-succeeded",
      message: "the local-CI lease claim succeeded — the gate can run",
      leaseId: response?.data?.lease?.leaseId || "",
      admissionStatus: response?.data?.admission?.status || "",
    };
  }

  if (response && typeof response === "object" && response.success === false) {
    const code = typeof response.error === "string" ? response.error : "";
    const message = truncate(`${code}${response.message ? `: ${response.message}` : ""}` || JSON.stringify(response));
    if (AUTH_RE.test(message)) {
      return { infrastructureUnavailable: true, kind: "credential-rejected", message };
    }
    return { infrastructureUnavailable: false, outcome: "claim-refused", message };
  }

  return {
    infrastructureUnavailable: false,
    outcome: "unclassified",
    message: truncate(typeof response === "string" ? response : JSON.stringify(response)),
  };
}

/**
 * Re-attempt the gate's lease claim and turn the outcome into evidence or a refusal.
 *
 * Every side effect is injectable so the contract is testable without a host:
 * `call` (mcpCall), `resolveCredential` (resolveMcpCredential), `env`, `now`.
 *
 * @returns {Promise<{ ok: true, evidence: object } | { ok: false, refusal: string, outcome: string, details?: object }>}
 */
export async function probeGateInfrastructure({
  mcpUrl,
  branch,
  sha,
  worktreePath,
  portalUrl,
  ports = [],
  env = process.env,
  call = mcpCall,
  resolveCredential = resolveMcpCredential,
  now = () => Date.now(),
  timeoutMs = 15_000,
} = {}) {
  if (!mcpUrl) throw new Error("probeGateInfrastructure: mcpUrl is required");

  let credential;
  try {
    credential = resolveCredential({ mcpUrl, env });
  } catch (error) {
    return {
      ok: false,
      outcome: "no-credential",
      refusal:
        `${GATE_INFRASTRUCTURE_UNAVAILABLE_CODE} needs a captured failure response from the lease claim, ` +
        `and no MCP credential is configured to attempt one (${truncate(errorMessage(error))}). ` +
        "Configure a credential so the probe can record the actual failure, or use a different code.",
    };
  }

  const identity = resolveAgentIdentity({ env, pid: process.pid });
  const ownerProvider = identity.provider ?? "external";
  const ownerSessionId = identity.sessionId;
  const startedAt = now();
  const probedAt = new Date(startedAt).toISOString();
  const claimArgs = {
    environmentKey: "local-integration-ci",
    ownerProvider,
    ownerSessionId,
    claimKey: `local-ci:${ownerSessionId}:${sha}:infrastructure-probe`,
    purpose: `pre-push ${GATE_INFRASTRUCTURE_UNAVAILABLE_CODE} probe for ${branch} @ ${sha}`,
    url: portalUrl,
    ports,
    // A probe never waits its turn: it asks whether the pool answers at all.
    expiresAt: new Date(startedAt + 60_000).toISOString(),
    waitDeadlineAt: probedAt,
    worktreePath,
    branchName: branch,
  };

  let outcome;
  try {
    const response = await call(PROBE_TOOL, claimArgs, { mcpUrl, bearerToken: credential.bearer, timeoutMs });
    outcome = classifyLeaseProbeOutcome({ response });
  } catch (error) {
    outcome = classifyLeaseProbeOutcome({ error });
  }
  const durationMs = Math.max(0, now() - startedAt);

  if (outcome.infrastructureUnavailable) {
    return {
      ok: true,
      evidence: {
        code: GATE_INFRASTRUCTURE_UNAVAILABLE_CODE,
        tool: PROBE_TOOL,
        endpoint: mcpUrl,
        credentialKind: credential.kind,
        credentialSource: credential.source,
        kind: outcome.kind,
        message: outcome.message,
        ...(outcome.statusCode ? { statusCode: outcome.statusCode } : {}),
        probedAt,
        durationMs,
      },
    };
  }

  if (outcome.outcome === "claim-succeeded") {
    let released = null;
    if (outcome.leaseId) {
      try {
        const releaseResponse = await call(
          PROBE_RELEASE_TOOL,
          { leaseId: outcome.leaseId, ownerSessionId },
          { mcpUrl, bearerToken: credential.bearer, timeoutMs },
        );
        released = releaseResponse?.success === true
          ? "released"
          : `release failed: ${truncate(JSON.stringify(releaseResponse))}`;
      } catch (error) {
        released = `release failed: ${truncate(errorMessage(error))}`;
      }
    }
    return {
      ok: false,
      outcome: "claim-succeeded",
      details: { leaseId: outcome.leaseId, admissionStatus: outcome.admissionStatus, released },
      refusal:
        `the local-CI lease claim succeeded (admission=${outcome.admissionStatus || "unknown"}` +
        `${outcome.leaseId ? `, lease ${outcome.leaseId} ${released ?? "not released"}` : ""}) — ` +
        `the gate's infrastructure is available, so run it: pnpm run pregate. ` +
        `${GATE_INFRASTRUCTURE_UNAVAILABLE_CODE} is refused.`,
    };
  }

  return {
    ok: false,
    outcome: outcome.outcome,
    refusal:
      `the lease claim was answered by a reachable, authenticating server (${outcome.message}); ` +
      `that is not an infrastructure failure, so ${GATE_INFRASTRUCTURE_UNAVAILABLE_CODE} is refused. ` +
      "Resolve the refusal and run pnpm run pregate, or use a code that fits.",
  };
}
