// Phase 5 — compliance-coworker write-with-approval. Pure types + validation for
// a proposed GRC change. The coworker is accountable for keeping the register
// current but authoritative writes stay human-in-the-loop: it PROPOSES here, a
// human approves, and approval commits via the existing create/link actions.
// Kept dependency-free so it is unit-testable and safe on the client.

export const PROPOSAL_KINDS = ["control-mapping", "regulation", "obligation"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export const PROPOSAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** control-mapping: link an existing control to an existing obligation (a crosswalk). */
export type ControlMappingPayload = { controlId: string; obligationId: string };

export function isProposalKind(v: string | null | undefined): v is ProposalKind {
  return typeof v === "string" && (PROPOSAL_KINDS as readonly string[]).includes(v);
}

/**
 * Validate a proposal payload for its kind. Returns an error string, or null when
 * valid. Only `control-mapping` is committable end-to-end in this phase; the
 * other kinds validate structurally and stage for human authoring/commit.
 */
export function validateProposalPayload(kind: string, payload: unknown): string | null {
  if (!isProposalKind(kind)) return `Unknown proposal kind: ${kind}`;
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
    return "Proposal payload must be an object.";
  }
  const p = payload as Record<string, unknown>;
  if (kind === "control-mapping") {
    if (typeof p.controlId !== "string" || !p.controlId) return "control-mapping requires a controlId.";
    if (typeof p.obligationId !== "string" || !p.obligationId) return "control-mapping requires an obligationId.";
    return null;
  }
  if (kind === "regulation") {
    if (typeof p.name !== "string" || !p.name) return "regulation proposal requires a name.";
    return null;
  }
  if (kind === "obligation") {
    if (typeof p.title !== "string" || !p.title) return "obligation proposal requires a title.";
    if (typeof p.regulationId !== "string" || !p.regulationId) return "obligation proposal requires a regulationId.";
    return null;
  }
  return null;
}

export function parseControlMappingPayload(payload: unknown): ControlMappingPayload | null {
  if (validateProposalPayload("control-mapping", payload) !== null) return null;
  const p = payload as Record<string, unknown>;
  return { controlId: p.controlId as string, obligationId: p.obligationId as string };
}
