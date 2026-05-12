// Edge Node enrollment orchestration.
//
// Implements the enrollment ceremony from the spec's "Enrollment, rotation,
// and lifecycle" section. Wires together bootstrap-token consumption,
// Principal + PrincipalAlias creation (per AGENTS.md §11 Principal
// convergence), EdgeNode row creation, and the initial node-token
// issuance — all inside a single $transaction so a partial failure
// can't leave a consumed bootstrap token pointing at a half-built
// EdgeNode.
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
//   - Enrollment ceremony diagram
//   - Approval policy (auto-approve for local-host installer-issued
//     bootstrap tokens; operator approval for everything else)
//   - Principal convergence (Principal { kind: "edge-node" } +
//     PrincipalAlias { aliasType: "edge-node", aliasValue: nodeId })

import { createHash, randomBytes } from "crypto";

import { prisma } from "@dpf/db";

import {
  DEFAULT_NODE_SCOPES,
  EDGE_TOKEN_PREFIX,
  type EdgeScope,
} from "./tokens";

const NODE_ID_BYTES = 6;
const PRINCIPAL_ID_PREFIX = "PRN-EDGE-";
const NODE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const PREFIX_DISPLAY_LENGTH = 12;

const BASE32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const SECRET_BYTES = 24;

function encodeBase32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

function generateNodeToken(): { plaintext: string; hash: string; prefix: string } {
  const secret = encodeBase32(randomBytes(SECRET_BYTES));
  const plaintext = `${EDGE_TOKEN_PREFIX}${secret}`;
  const hash = createHash("sha256").update(plaintext).digest("hex");
  const prefix = plaintext.slice(0, PREFIX_DISPLAY_LENGTH);
  return { plaintext, hash, prefix };
}

function hashSecret(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

function generateNodeId(): string {
  return `edge_${randomBytes(NODE_ID_BYTES).toString("hex")}`;
}

function generatePrincipalId(): string {
  return `${PRINCIPAL_ID_PREFIX}${randomBytes(8).toString("hex")}`;
}

export type EnrollEdgeNodeInput = {
  bootstrapTokenPlaintext: string;
  displayName: string;
  platform: "darwin" | "linux" | "win32";
  installMode: "native" | "container-host" | "container-vm";
  version: string;
  capabilities: ReadonlyArray<string>;
  metadata?: Record<string, unknown> | null;
  hostFingerprint?: string;
  // The Authority Core can override the default token scopes per node.
  // Defaults to DEFAULT_NODE_SCOPES (heartbeat + rotate + submit + fetch).
  scopes?: ReadonlyArray<EdgeScope>;
};

export type EnrollEdgeNodeResult =
  | {
      ok: true;
      nodeId: string;
      edgeNodeId: string;
      principalId: string;
      trustState: "pending" | "trusted";
      nodeToken: {
        plaintext: string;
        prefix: string;
        expiresAt: Date;
        scopes: EdgeScope[];
      };
    }
  | {
      ok: false;
      status: 400 | 401 | 409;
      error:
        | "invalid_format"
        | "missing_fields"
        | "bootstrap_not_found"
        | "bootstrap_revoked"
        | "bootstrap_already_consumed"
        | "bootstrap_expired";
    };

const ALLOWED_PLATFORMS = new Set(["darwin", "linux", "win32"]);
const ALLOWED_INSTALL_MODES = new Set(["native", "container-host", "container-vm"]);

function validateInputShape(
  input: EnrollEdgeNodeInput,
): { ok: true } | { ok: false; error: "missing_fields" | "invalid_format" } {
  if (!input.displayName?.trim()) return { ok: false, error: "missing_fields" };
  if (!input.version?.trim()) return { ok: false, error: "missing_fields" };
  if (!ALLOWED_PLATFORMS.has(input.platform)) return { ok: false, error: "invalid_format" };
  if (!ALLOWED_INSTALL_MODES.has(input.installMode)) return { ok: false, error: "invalid_format" };
  if (!Array.isArray(input.capabilities)) return { ok: false, error: "invalid_format" };
  return { ok: true };
}

export async function enrollEdgeNode(
  input: EnrollEdgeNodeInput,
): Promise<EnrollEdgeNodeResult> {
  const shape = validateInputShape(input);
  if (!shape.ok) return { ok: false, status: 400, error: shape.error };

  if (typeof input.bootstrapTokenPlaintext !== "string"
    || !input.bootstrapTokenPlaintext.startsWith(EDGE_TOKEN_PREFIX)
  ) {
    return { ok: false, status: 401, error: "invalid_format" };
  }

  const bootstrapHash = hashSecret(input.bootstrapTokenPlaintext);
  const bootstrap = await prisma.bootstrapToken.findUnique({
    where: { tokenHash: bootstrapHash },
  });
  if (!bootstrap) return { ok: false, status: 401, error: "bootstrap_not_found" };
  if (bootstrap.revokedAt) {
    return { ok: false, status: 401, error: "bootstrap_revoked" };
  }
  if (bootstrap.consumedAt) {
    return { ok: false, status: 409, error: "bootstrap_already_consumed" };
  }
  if (bootstrap.expiresAt.getTime() < Date.now()) {
    return { ok: false, status: 401, error: "bootstrap_expired" };
  }

  const autoApprove = isAutoApprovePolicy(bootstrap.metadata);
  const trustState = autoApprove ? "trusted" : "pending";
  const principalId = generatePrincipalId();
  const nodeId = generateNodeId();
  const scopes: EdgeScope[] = [...(input.scopes ?? DEFAULT_NODE_SCOPES)];

  const nodeToken = generateNodeToken();
  const tokenExpiresAt = new Date(Date.now() + NODE_TOKEN_TTL_MS);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const principal = await tx.principal.create({
        data: {
          principalId,
          kind: "edge-node",
          status: "active",
          displayName: input.displayName.trim(),
        },
      });
      await tx.principalAlias.create({
        data: {
          principalId: principal.id,
          aliasType: "edge-node",
          aliasValue: nodeId,
          issuer: "",
        },
      });
      const node = await tx.edgeNode.create({
        data: {
          principalId: principal.id,
          nodeId,
          platform: input.platform,
          installMode: input.installMode,
          version: input.version,
          status: trustState === "trusted" ? "active" : "pending",
          trustState,
          capabilities: [...input.capabilities] as unknown as object,
          metadata: (input.metadata ?? undefined) as object | undefined,
          enrollmentTokenId: bootstrap.id,
          enrolledAt: new Date(),
          approvedAt: autoApprove ? new Date() : null,
        },
      });
      await tx.bootstrapToken.update({
        where: { id: bootstrap.id },
        data: {
          consumedAt: new Date(),
          consumedByEdgeNodeId: node.id,
        },
      });
      await tx.edgeNodeToken.create({
        data: {
          edgeNodeId: node.id,
          tokenHash: nodeToken.hash,
          prefix: nodeToken.prefix,
          scopes,
          expiresAt: tokenExpiresAt,
        },
      });
      return { node, principal };
    });

    return {
      ok: true,
      nodeId: created.node.nodeId,
      edgeNodeId: created.node.id,
      principalId: created.principal.id,
      trustState,
      nodeToken: {
        plaintext: nodeToken.plaintext,
        prefix: nodeToken.prefix,
        expiresAt: tokenExpiresAt,
        scopes,
      },
    };
  } catch (err) {
    // Race protection: the @unique on consumedByEdgeNodeId means a
    // concurrent enroll that already consumed this bootstrap token will
    // cause the transaction to fail. Surface that as bootstrap_already_consumed.
    if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
      return { ok: false, status: 409, error: "bootstrap_already_consumed" };
    }
    throw err;
  }
}

function isAutoApprovePolicy(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const record = metadata as Record<string, unknown>;
  return record.autoApprove === true;
}
