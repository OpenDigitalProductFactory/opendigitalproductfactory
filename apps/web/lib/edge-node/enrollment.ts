// Enrollment business logic for the DPF Edge Node Phase 0.
//
// Operator (or installer) issues a bootstrap token via Admin > Platform
// Development. Edge Node calls POST /api/v1/edge/enroll with the
// bootstrap token + its host fingerprint + advertised capabilities.
// This module:
//
//   1. Validates the bootstrap token (single-use, not revoked, not
//      expired) per BootstrapToken invariants.
//   2. Atomically (in a Prisma transaction):
//      - Marks the bootstrap token consumed.
//      - Creates a Principal + PrincipalAlias pair for the EdgeNode's
//        identity (per AGENTS.md §11 principal-convergence rule).
//      - Creates the EdgeNode row with the chosen trustState
//        (per spec § Approval policy: auto-approved if the bootstrap
//        token's `scope` flags it as installer-issued local-host;
//        otherwise pending operator approval).
//      - Mints a node token (dpfedge_*) and stores its hash.
//      - Creates EdgeNodeCapability rows for the accepted capability
//        intersection.
//   3. Returns the plaintext node token + intervals (heartbeat / sweep)
//      so the Edge Node can immediately start operating.
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
//   § Enrollment, rotation, and lifecycle
//   § Approval policy
//   § Token namespaces and lifecycle

import { randomUUID } from "crypto";

import { prisma } from "@dpf/db";

import { getErrorMessage } from "@/lib/shared/get-error-message";

import { supersedeStaleInstallerNodes, type StaleSupersessionDb } from "./stale-supersession";
import {
  EDGE_NODE_ALIAS_KIND,
  EDGE_NODE_ENROLLMENT_CAPABILITIES,
  EDGE_NODE_INSTALL_MODES,
  EDGE_NODE_PLATFORMS,
  isBootstrapTokenUsable,
  type EdgeNodeInstallMode,
  type EdgeNodePlatform,
  type EdgeNodeEnrollmentCapability,
} from "@dpf/db/edge-node-types";

import {
  classifyTokenPrefix,
  computeBootstrapExpiry,
  generateBootstrapToken,
  generateNodeToken,
  hashToken,
} from "./tokens";
import { normalizeEdgeNodeScopeBinding } from "./scope";

// ── Issuance (operator-side) ─────────────────────────────────────────────────

export type IssueBootstrapInput = {
  /** Operator (or installer service-account) Principal id. */
  issuedByPrincipalId: string;
  /** TTL in milliseconds. Defaults to 15 min; capped at 24h per spec. */
  ttlMs?: number;
  /**
   * Reserved for future scope expansion. Phase 0 only accepts
   * `edge:enroll`. Out-of-band scopes are rejected at the API layer,
   * not here.
   */
  scope?: string;
  /**
   * If true, persist `autoApprove=true` on the BootstrapToken row.
   * When the Edge Node consumes this token at enrollment, the new
   * EdgeNode lands directly in `trustState=trusted` instead of
   * `pending` — per spec § Approval policy.
   *
   * Intended for two paths:
   *   1. Installer auto-issuance for the DPF host's own Edge Node
   *      (single-host install — the operator running install-dpf.sh
   *      has already proven host access; the Approve click would be
   *      ceremonial).
   *   2. Operator bulk-onboarding via Admin > Platform Development
   *      where the operator wants to skip the per-node approval.
   *
   * Defaults to false. Paste-provisioned tokens for remote nodes
   * should always be false (the Approve click is the friction that
   * makes remote enrollment opt-in).
   */
  autoApprove?: boolean;
  /** Optional MSP customer-account install target. */
  targetCustomerAccountId?: string | null;
  /** Optional MSP customer-site install target; requires account target. */
  targetCustomerSiteId?: string | null;
  /** Optional policy metadata. Defaults from the customer/site target. */
  scopePolicy?: Record<string, unknown> | null;
  /**
   * Bind this token to the operator's own internal company-owned estate
   * (`organization` ownership scope) rather than an MSP customer. Mutually
   * exclusive with the customer-account/site targets. See the scope helper
   * and the internal-estate substrate audit for the per-location roadmap.
   */
  organizationScoped?: boolean;
};

export type IssueBootstrapResult = {
  /** The opaque tokenId — for revocation lookup. */
  tokenId: string;
  /** Plaintext token. SHOWN TO OPERATOR ONCE; never persisted. */
  plaintext: string;
  /** First 12 chars of the plaintext for visual ID in operator lists. */
  prefix: string;
  /** When this token will stop being usable. */
  expiresAt: Date;
};

/**
 * Mint a new bootstrap token. The plaintext appears in the response
 * exactly once; the caller must surface it to the operator immediately
 * and not log it. Only the hash and prefix are persisted.
 */
export async function issueBootstrapToken(
  input: IssueBootstrapInput,
): Promise<IssueBootstrapResult> {
  const { plaintext, hash, prefix } = generateBootstrapToken();
  const expiresAt = computeBootstrapExpiry(input.ttlMs);
  const scopeBinding = normalizeEdgeNodeScopeBinding({
    customerAccountId: input.targetCustomerAccountId,
    customerSiteId: input.targetCustomerSiteId,
    scopePolicy: input.scopePolicy,
    organizationScoped: input.organizationScoped,
  });

  const row = await prisma.bootstrapToken.create({
    data: {
      tokenHash: hash,
      prefix,
      scope: input.scope ?? "edge:enroll",
      issuedByPrincipalId: input.issuedByPrincipalId,
      expiresAt,
      autoApprove: input.autoApprove === true,
      targetCustomerAccountId: scopeBinding.customerAccountId,
      targetCustomerSiteId: scopeBinding.customerSiteId,
      scopePolicy: scopeBinding.scopePolicy as never,
    },
  });

  return {
    tokenId: row.id,
    plaintext,
    prefix,
    expiresAt,
  };
}

// ── Enrollment (Edge-Node-side) ──────────────────────────────────────────────

export type EnrollInput = {
  /** Plaintext bootstrap token presented by the Edge Node. */
  bootstrapToken: string;
  /** Operator-set or agent-derived display name. */
  displayName: string;
  /** "darwin" | "win32" | "linux". */
  platform: EdgeNodePlatform;
  /** "native" | "container-host" | "container-vm". */
  installMode: EdgeNodeInstallMode;
  /** Edge Node binary version, e.g. "0.1.0". */
  version: string;
  /** Capabilities the agent advertises support for. */
  advertisedCapabilities: string[];
  /** Host fingerprint for verification + drift detection. */
  hostFingerprint?: string;
  /** Free-form metadata — hostname, tags, OS details. */
  metadata?: Record<string, unknown>;
  /**
   * Force-override the token's `autoApprove` flag. Optional —
   * when omitted, the BootstrapToken row's persisted `autoApprove`
   * column is the source of truth per spec § Approval policy.
   *
   * Callers should leave this undefined in normal operation. The
   * route layer hardcoded `false` historically and is being moved
   * to undefined as part of installer-bundled-Edge-Node work; the
   * field is retained as an override for tests and for future
   * paths that need to demote an auto-approve token without
   * re-issuing it.
   */
  autoApprove?: boolean;
};

export type EnrollResult =
  | {
      ok: true;
      edgeNodeId: string;
      /** Stable external identifier; appears in API URLs going forward. */
      nodeId: string;
      /** Plaintext node token. SENT TO EDGE NODE ONCE. */
      nodeToken: string;
      /** Authority-decided heartbeat interval (seconds). */
      heartbeatIntervalSec: number;
      /** Authority-decided discovery sweep interval (seconds). */
      sweepIntervalSec: number;
      /** Capabilities the Authority accepted from the agent's advertised set. */
      acceptedCapabilities: EdgeNodeEnrollmentCapability[];
      /** trustState at enrollment ("trusted" if auto-approved else "pending"). */
      trustState: "trusted" | "pending";
      /** Customer-account scope copied from the consumed bootstrap token. */
      customerAccountId: string | null;
      /** Customer-site scope copied from the consumed bootstrap token. */
      customerSiteId: string | null;
      /** Policy metadata copied from the consumed bootstrap token. */
      scopePolicy: Record<string, unknown> | null;
    }
  | {
      ok: false;
      error:
        | "invalid_token_format"
        | "token_not_found"
        | "token_expired"
        | "token_already_consumed"
        | "token_revoked"
        | "invalid_platform"
        | "invalid_install_mode"
        | "no_acceptable_capabilities";
      message: string;
    };

const DEFAULT_HEARTBEAT_INTERVAL_SEC = 60;
const DEFAULT_SWEEP_INTERVAL_SEC = 300; // 5 min

/**
 * Validate a bootstrap token + create an EdgeNode + Principal + alias
 * + initial capabilities atomically. Returns the plaintext node token
 * for the agent.
 */
export async function enrollEdgeNode(input: EnrollInput): Promise<EnrollResult> {
  // Cheap precondition: prefix must look like a bootstrap token. Avoids
  // burning a hash on garbage input and accidentally matching a node
  // token by collision.
  if (classifyTokenPrefix(input.bootstrapToken) !== "bootstrap") {
    return {
      ok: false,
      error: "invalid_token_format",
      message: "bootstrap token must use the dpfboot_ prefix",
    };
  }

  if (!EDGE_NODE_PLATFORMS.includes(input.platform)) {
    return {
      ok: false,
      error: "invalid_platform",
      message: `platform must be one of: ${EDGE_NODE_PLATFORMS.join(", ")}`,
    };
  }
  if (!EDGE_NODE_INSTALL_MODES.includes(input.installMode)) {
    return {
      ok: false,
      error: "invalid_install_mode",
      message: `installMode must be one of: ${EDGE_NODE_INSTALL_MODES.join(", ")}`,
    };
  }

  const acceptedCapabilities = input.advertisedCapabilities.filter(
    (cap): cap is EdgeNodeEnrollmentCapability =>
      (EDGE_NODE_ENROLLMENT_CAPABILITIES as readonly string[]).includes(cap),
  );
  if (acceptedCapabilities.length === 0) {
    return {
      ok: false,
      error: "no_acceptable_capabilities",
      message: `Enrollment accepts only: ${EDGE_NODE_ENROLLMENT_CAPABILITIES.join(", ")}`,
    };
  }

  const presentedHash = hashToken(input.bootstrapToken);
  const tokenRow = await prisma.bootstrapToken.findUnique({
    where: { tokenHash: presentedHash },
  });

  if (!tokenRow) {
    return {
      ok: false,
      error: "token_not_found",
      message: "bootstrap token does not match any issued token",
    };
  }
  if (tokenRow.consumedAt !== null) {
    return {
      ok: false,
      error: "token_already_consumed",
      message: "bootstrap token has already been consumed",
    };
  }
  if (tokenRow.revokedAt !== null) {
    return {
      ok: false,
      error: "token_revoked",
      message: "bootstrap token was revoked before consumption",
    };
  }
  if (!isBootstrapTokenUsable(tokenRow)) {
    return {
      ok: false,
      error: "token_expired",
      message: "bootstrap token has expired",
    };
  }

  const nodeId = `edge_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const nodeToken = generateNodeToken();
  // Effective auto-approve: explicit override wins; otherwise the
  // token's persisted flag drives. This lets the route layer stop
  // hardcoding `false` and trust the issuance contract — paste-
  // provisioned tokens default to autoApprove=false on the row,
  // installer-issued ones default to true.
  const effectiveAutoApprove =
    input.autoApprove !== undefined ? input.autoApprove : tokenRow.autoApprove;
  const trustState = effectiveAutoApprove ? "trusted" : "pending";
  const status = effectiveAutoApprove ? "active" : "pending";
  const now = new Date();
  const scopeBinding = normalizeEdgeNodeScopeBinding({
    customerAccountId: tokenRow.targetCustomerAccountId,
    customerSiteId: tokenRow.targetCustomerSiteId,
    scopePolicy: tokenRow.scopePolicy as Record<string, unknown> | null,
  });

  // Atomic transaction: consume the bootstrap token + create the
  // Principal + alias + EdgeNode + initial capability rows. If any
  // step fails the whole enrollment unwinds, leaving the bootstrap
  // token usable for a retry.
  await prisma.$transaction(async (tx) => {
    // 1. Consume the bootstrap token (single-use).
    await tx.bootstrapToken.update({
      where: {
        id: tokenRow.id,
        // Optimistic concurrency: only update if still unconsumed.
        // If two enrolls race the same token, one wins and the other
        // gets a not-found here, which propagates as the transaction
        // rollback the API layer maps to `token_already_consumed`.
        consumedAt: null,
      },
      data: {
        consumedAt: now,
      },
    });

    // 2. Create the convergent Principal for the Edge Node identity.
    const principal = await tx.principal.create({
      data: {
        principalId: `principal_${nodeId}`,
        kind: EDGE_NODE_ALIAS_KIND,
        displayName: input.displayName,
      },
    });

    // 3. Create the alias so authorization decisions can resolve
    //    through Principal regardless of which surface authenticated.
    await tx.principalAlias.create({
      data: {
        principalId: principal.id,
        aliasType: EDGE_NODE_ALIAS_KIND,
        aliasValue: nodeId,
      },
    });

    // 4. Create the EdgeNode row. Per AGENTS.md §11 Principal
    //    convergence (retrofit in migration 20260512030000), EdgeNode
    //    is keyed 1:1 to Principal via principalId. displayName lives
    //    on Principal — readers join through `edgeNode.principal`.
    const edgeNode = await tx.edgeNode.create({
      data: {
        principalId: principal.id,
        nodeId,
        platform: input.platform,
        installMode: input.installMode,
        version: input.version,
        status,
        trustState,
        capabilities: input.advertisedCapabilities,
        metadata: input.metadata
          ? {
              ...input.metadata,
              hostFingerprint: input.hostFingerprint ?? null,
            }
          : input.hostFingerprint
            ? { hostFingerprint: input.hostFingerprint }
            : undefined,
        tokenHash: nodeToken.hash,
        tokenPrefix: nodeToken.prefix,
        tokenRotatedAt: now,
        enrolledAt: now,
        customerAccountId: scopeBinding.customerAccountId,
        customerSiteId: scopeBinding.customerSiteId,
        scopePolicy: scopeBinding.scopePolicy as never,
        ...(effectiveAutoApprove
          ? { approvedAt: now, approvedByPrincipalId: tokenRow.issuedByPrincipalId }
          : {}),
      },
    });

    // 5. Link the consumed bootstrap token to the EdgeNode for audit.
    await tx.bootstrapToken.update({
      where: { id: tokenRow.id },
      data: { consumedByEdgeNodeId: edgeNode.id },
    });

    // 6. Create capability rows for the accepted set. Mode = `enabled`
    //    for auto-approved nodes; `disabled` for pending nodes (they
    //    can heartbeat but Authority does not yet accept their
    //    submissions).
    const mode = effectiveAutoApprove ? "enabled" : "disabled";
    for (const capability of acceptedCapabilities) {
      await tx.edgeNodeCapability.create({
        data: {
          edgeNodeId: edgeNode.id,
          capability,
          mode,
          status: "unknown",
        },
      });
    }
  });

  // An installer-managed re-enrollment is the moment a previous, long-silent
  // installer enrollment becomes provably obsolete. Retire it now rather than
  // leaving "Enrollment conflict" for a human (BI-D4F79CE2). Best-effort: a
  // failure here must not fail the enrollment that just succeeded.
  if (effectiveAutoApprove) {
    try {
      await supersedeStaleInstallerNodes(prisma as unknown as StaleSupersessionDb, { now });
    } catch (error) {
      console.warn(`[edge-enrollment] stale-enrollment supersession skipped: ${getErrorMessage(error)}`);
    }
  }

  return {
    ok: true,
    edgeNodeId: nodeId,
    nodeId,
    nodeToken: nodeToken.plaintext,
    heartbeatIntervalSec: DEFAULT_HEARTBEAT_INTERVAL_SEC,
    sweepIntervalSec: DEFAULT_SWEEP_INTERVAL_SEC,
    acceptedCapabilities,
    trustState,
    customerAccountId: scopeBinding.customerAccountId,
    customerSiteId: scopeBinding.customerSiteId,
    scopePolicy: scopeBinding.scopePolicy,
  };
}

// ── Heartbeat (Edge-Node-side) ───────────────────────────────────────────────

export type HeartbeatInput = {
  /** Resolved EdgeNode (auth middleware loads this). */
  edgeNodeId: string;
  /** Optional capability self-report from the agent. */
  capabilityReports?: Array<{
    capability: string;
    status: "healthy" | "degraded" | "failing" | "unknown";
    evidence?: Record<string, unknown>;
  }>;
};

export type HeartbeatResult = {
  /** Echo of the Authority-decided heartbeat interval. */
  heartbeatIntervalSec: number;
  /** Echo of the Authority-decided sweep interval. */
  sweepIntervalSec: number;
  /** Capabilities currently accepted (Authority can revoke between heartbeats). */
  acceptedCapabilities: string[];
};

/**
 * Update lastSeenAt; optionally update per-capability status from the
 * agent's self-report. Returns the current intervals + accepted-
 * capability set so the agent can adjust on the fly without restart.
 */
export async function recordHeartbeat(
  input: HeartbeatInput,
): Promise<HeartbeatResult> {
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.edgeNode.update({
      where: { id: input.edgeNodeId },
      data: {
        lastSeenAt: now,
        // Pending nodes flip to active on first heartbeat.
        status: "active",
      },
    });

    if (input.capabilityReports) {
      for (const report of input.capabilityReports) {
        // Upsert capability rows: edge case where agent advertises a
        // new capability post-enrollment. Authority defaults new
        // capabilities to disabled until operator promotes them.
        await tx.edgeNodeCapability.upsert({
          where: {
            edgeNodeId_capability: {
              edgeNodeId: input.edgeNodeId,
              capability: report.capability,
            },
          },
          create: {
            edgeNodeId: input.edgeNodeId,
            capability: report.capability,
            mode: "disabled",
            status: report.status,
            evidence: (report.evidence ?? null) as never,
            reportedAt: now,
          },
          update: {
            status: report.status,
            evidence: (report.evidence ?? null) as never,
            reportedAt: now,
          },
        });
      }
    }
  });

  // Query accepted capabilities (mode=enabled or reporting-only) to
  // tell the agent what Authority will currently accept submissions
  // for. Done after the transaction so the agent's reports influence
  // the response shape immediately.
  const accepted = await prisma.edgeNodeCapability.findMany({
    where: {
      edgeNodeId: input.edgeNodeId,
      mode: { in: ["enabled", "reporting-only"] },
    },
    select: { capability: true },
  });

  return {
    heartbeatIntervalSec: DEFAULT_HEARTBEAT_INTERVAL_SEC,
    sweepIntervalSec: DEFAULT_SWEEP_INTERVAL_SEC,
    acceptedCapabilities: accepted.map((row) => row.capability),
  };
}
