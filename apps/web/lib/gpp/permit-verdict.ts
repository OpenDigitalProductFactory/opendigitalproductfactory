// Permit verdicts: evaluate one permit against one call, and record the result.
//
// GPP Phase 2, PR-C (docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md).
// Scope baseline: OBJ-PERMIT, OBJ-NODISRUPT, OBJ-CRITICAL; acceptance AC-SHADOW-PERMIT.
//
// Shadow by contract. Nothing here returns a refusal and nothing here throws:
// the monitor records the verdict and continues unconditionally. Only a
// binding promoted by a recorded decision (PR-E) may ever act on a verdict.

import type { GppPermitVerdict } from "@dpf/db";

import { bindingForAdmittedCall, type GppBindingToolFacts } from "./bindings";
import { mintShadowPermit } from "./permit-mint";
import { gppPermitStore, type PermitObservationCreate, type PermitRow } from "./permit-store";

/** Longest handle the monitor will look up; anything longer is not a permit id. */
export const MAX_PERMIT_HANDLE_LENGTH = 256;

type VerdictRow = Pick<PermitRow, "expiresAt" | "revokedAt" | "useCount" | "maxUses" | "capabilities">;

/**
 * Pure. The PR-C checks, in order: presence, revocation, expiry, uses, tool
 * membership. PR-D puts MAC, parameter-hash and lineage checks in front.
 */
export function evaluatePermitVerdict(
  row: VerdictRow | null,
  call: { toolName: string; now?: Date },
): Exclude<GppPermitVerdict, "ungoverned" | "unmediated"> {
  if (!row) return "absent";
  const now = call.now ?? new Date();
  if (row.revokedAt) return "revoked";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  if (row.useCount >= row.maxUses) return "exhausted";
  if (!row.capabilities.some((capability) => capability.tool === call.toolName)) return "tool_not_in_capabilities";
  return "valid";
}

/** Audit-only write. Never throws: a failed observation never fails the call. */
export async function recordPermitObservation(data: PermitObservationCreate): Promise<void> {
  try {
    await gppPermitStore().createObservation(data);
  } catch (err) {
    console.error(
      "[gpp-permit] observation write failed tool=%s verdict=%s: %s",
      JSON.stringify(data.toolName),
      JSON.stringify(data.verdict),
      err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
    );
  }
}

export type MonitorPermitInput = {
  toolName: string;
  tool: GppBindingToolFacts;
  /** The alignment gate ran for this call and approved it. */
  alignmentApproved: boolean;
  alignmentInteractionId: string | null;
  approvedEnvelopeId: string | null;
  authorityDecisionId: string | null;
  actorUserId: string;
  actorAgentId: string | null;
  workroomId: string | null;
  /** A handle the caller presented (an external client replaying a permit). */
  permitHandle?: string;
  now?: Date;
};

export type MonitorPermitOutcome = {
  verdict: GppPermitVerdict;
  /** The cited permit's opaque id ("GPM-..."), forwarded to the handler and the audit row. */
  permitId: string | null;
  permitRowId: string | null;
  bindingId: string | null;
  detail: Record<string, unknown>;
};

function presentedHandle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const handle = value.trim();
  if (!handle || handle.length > MAX_PERMIT_HANDLE_LENGTH) return null;
  return handle;
}

async function findPresented(handle: string): Promise<PermitRow | null> {
  try {
    return await gppPermitStore().findPermitByPermitId(handle);
  } catch (err) {
    console.error(
      "[gpp-permit] presented-handle lookup failed: %s",
      err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
    );
    return null;
  }
}

async function consume(row: PermitRow): Promise<void> {
  try {
    await gppPermitStore().consumePermit(row);
  } catch (err) {
    console.error(
      "[gpp-permit] permit use count failed permit=%s: %s",
      JSON.stringify(row.permitId),
      err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
    );
  }
}

/**
 * For one O/A/I call inside the reference monitor: mint under the binding whose
 * gate admitted it, evaluate the presented handle (or the minted permit), and
 * count the use. Returns the verdict to record. Never throws and never refuses.
 *
 * - no gate admitted and no handle presented → `ungoverned` (nothing changes);
 * - a gate admitted → a permit is minted and verified (`valid`, or `absent`
 *   when the mint failed);
 * - a handle was presented → that handle's row is verified (an unknown handle
 *   is `absent`).
 */
export async function resolveMonitorPermit(input: MonitorPermitInput): Promise<MonitorPermitOutcome> {
  const binding = bindingForAdmittedCall({
    tool: input.tool,
    alignmentApproved: input.alignmentApproved,
    approvedEnvelopeId: input.approvedEnvelopeId,
  });
  const handle = presentedHandle(input.permitHandle);
  try {
    const minted = binding
      ? await mintShadowPermit({
          binding,
          toolName: input.toolName,
          actorUserId: input.actorUserId,
          actorAgentId: input.actorAgentId,
          workroomId: input.workroomId,
          gateDecisionId: binding.admission === "alignment-approve" ? input.alignmentInteractionId : null,
          authorityDecisionId: input.authorityDecisionId,
          envelopeId: input.approvedEnvelopeId,
          now: input.now,
        })
      : null;
    if (!binding && !handle) {
      return { verdict: "ungoverned", permitId: null, permitRowId: null, bindingId: null, detail: {} };
    }
    const evaluated = handle ? await findPresented(handle) : minted;
    const verdict = evaluatePermitVerdict(evaluated, { toolName: input.toolName, now: input.now });
    if (verdict === "valid" && evaluated) await consume(evaluated);
    return {
      verdict,
      permitId: evaluated?.permitId ?? null,
      permitRowId: evaluated?.id ?? null,
      bindingId: evaluated?.bindingId ?? binding?.bindingId ?? null,
      detail: {
        handlePresented: Boolean(handle),
        ...(binding ? { admittedBy: binding.bindingId, bindingVersion: binding.version } : {}),
        ...(minted && minted.id !== evaluated?.id ? { mintedPermitId: minted.permitId } : {}),
        ...(binding && !minted ? { mintFailed: true } : {}),
      },
    };
  } catch (err) {
    console.error(
      "[gpp-permit] monitor permit resolution failed tool=%s: %s",
      JSON.stringify(input.toolName),
      err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
    );
    return {
      verdict: binding || handle ? "absent" : "ungoverned",
      permitId: null,
      permitRowId: null,
      bindingId: binding?.bindingId ?? null,
      detail: { resolutionFailed: true },
    };
  }
}
