// Permit verdicts: evaluate one permit against one call, and record the result.
//
// GPP Phase 2, PR-C (docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md).
// Scope baseline: OBJ-PERMIT, OBJ-NODISRUPT, OBJ-CRITICAL; acceptance AC-SHADOW-PERMIT.
//
// Shadow by contract. Nothing here returns a refusal and nothing here throws:
// the monitor records the verdict and continues unconditionally. Only a
// binding promoted by a recorded decision (PR-E) may ever act on a verdict.
//
// PR-D puts three checks in front of PR-C's, in the plan's order: the MAC over
// the claims (`mac_invalid`, or `unsigned` when the install has no key), the
// exact-call parameter hash (`param_mismatch`), and the lineage of the
// admitting decision (`lineage_missing`, `lineage_unsealed`). One verdict is
// recorded per call, the first that fails; every check's outcome is kept in
// `detail.checks`, so a later check is never lost behind an earlier one.

import type { GppPermitVerdict } from "@dpf/db";

import { bindingForAdmittedCall, gppBindings, type GppBindingToolFacts } from "./bindings";
import { computeParamHash } from "./param-hash";
import { parsePermitHandle, verifyPermitMac, type ParsedPermitHandle } from "./permit-handle";
import { mintShadowPermit, type MintedPermit } from "./permit-mint";
import {
  gppPermitStore,
  type PermitLineageRef,
  type PermitObservationCreate,
  type PermitRow,
} from "./permit-store";

/** Longest handle the monitor will look up; anything longer is not a permit id. */
export const MAX_PERMIT_HANDLE_LENGTH = 256;

type VerdictRow = Pick<PermitRow, "expiresAt" | "revokedAt" | "useCount" | "maxUses" | "capabilities">;

/** The PR-C state verdicts. */
export type PermitStateVerdict = "absent" | "valid" | "expired" | "revoked" | "exhausted" | "tool_not_in_capabilities";

/**
 * Pure. The PR-C checks, in order: presence, revocation, expiry, uses, tool
 * membership. PR-D puts MAC, parameter-hash and lineage checks in front
 * (verdictFromChecks).
 */
export function evaluatePermitVerdict(
  row: VerdictRow | null,
  call: { toolName: string; now?: Date },
): PermitStateVerdict {
  if (!row) return "absent";
  const now = call.now ?? new Date();
  if (row.revokedAt) return "revoked";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  if (row.useCount >= row.maxUses) return "exhausted";
  if (!row.capabilities.some((capability) => capability.tool === call.toolName)) return "tool_not_in_capabilities";
  return "valid";
}

/** Every check's outcome for one present permit row. Recorded in `detail.checks`. */
export type PermitChecks = {
  mac: "ok" | "invalid" | "unsigned";
  macReason?: string;
  /** `not_bound`: the row carries no paramHash; `not_checked`: the call's arguments were not supplied. */
  paramHash: "match" | "mismatch" | "not_bound" | "not_checked";
  /** `lookup_failed` is an infrastructure fault: it is recorded and decides nothing (fail open). */
  lineage: "sealed" | "unsealed" | "missing" | "lookup_failed";
  lineageReason?: string;
  state: Exclude<PermitStateVerdict, "absent">;
};

/** Pure. The plan's verification order: MAC, paramHash, lineage, then PR-C state. */
export function verdictFromChecks(checks: PermitChecks): GppPermitVerdict {
  if (checks.mac === "invalid") return "mac_invalid";
  if (checks.mac === "unsigned") return "unsigned";
  if (checks.paramHash === "mismatch") return "param_mismatch";
  if (checks.lineage === "missing") return "lineage_missing";
  if (checks.lineage === "unsealed") return "lineage_unsealed";
  return checks.state;
}

/**
 * Where this permit's lineage lives, by the admission of the binding that
 * minted it. Null with a reason when there is nothing to look up.
 */
function lineageRefOf(row: PermitRow): { ref: PermitLineageRef } | { missing: string } {
  const binding = gppBindings().find((candidate) => candidate.bindingId === row.bindingId);
  if (!binding) return { missing: "unknown-binding" };
  if (binding.admission === "alignment-approve") {
    return row.gateDecisionId
      ? { ref: { kind: "decision-interaction", interactionId: row.gateDecisionId } }
      : { missing: "no-gate-decision-ref" };
  }
  return row.authorityDecisionId
    ? { ref: { kind: "authorization-decision", decisionId: row.authorityDecisionId } }
    : { missing: "no-authority-decision-ref" };
}

async function checkLineage(row: PermitRow): Promise<Pick<PermitChecks, "lineage" | "lineageReason">> {
  const target = lineageRefOf(row);
  if ("missing" in target) return { lineage: "missing", lineageReason: target.missing };
  try {
    const lineage = await gppPermitStore().findLineage(target.ref);
    if (!lineage.found) return { lineage: "missing", lineageReason: `${target.ref.kind}-not-found` };
    if (lineage.sealed) return { lineage: "sealed" };
    // R1: the alignment gate's DecisionInteraction is written unsealed today,
    // and AuthorizationDecisionLog is not hash-chained at all.
    return {
      lineage: "unsealed",
      lineageReason: target.ref.kind === "authorization-decision" ? "authorization-log-not-chained" : "decision-not-sealed",
    };
  } catch (err) {
    console.error(
      "[gpp-permit] lineage lookup failed permit=%s: %s",
      JSON.stringify(row.permitId),
      err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
    );
    return { lineage: "lookup_failed" };
  }
}

function checkParamHash(
  row: PermitRow,
  call: { toolName: string; params?: Record<string, unknown> },
): PermitChecks["paramHash"] {
  if (!row.paramHash) return "not_bound";
  if (!call.params) return "not_checked";
  return computeParamHash(call.toolName, call.params) === row.paramHash ? "match" : "mismatch";
}

/** Run every check on a present row. Never throws past the lineage lookup's own catch. */
export async function checkPermit(
  row: PermitRow,
  handle: ParsedPermitHandle | null,
  call: { toolName: string; params?: Record<string, unknown>; now?: Date },
): Promise<PermitChecks> {
  const mac = verifyPermitMac(row, handle);
  const state = evaluatePermitVerdict(row, call) as PermitChecks["state"];
  return {
    mac: mac.result,
    ...("reason" in mac ? { macReason: mac.reason } : {}),
    paramHash: checkParamHash(row, call),
    ...(await checkLineage(row)),
    state,
  };
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
  /** The received call's arguments: bound at mint, compared on a presented handle. */
  params?: Record<string, unknown>;
  now?: Date;
};

export type MonitorPermitOutcome = {
  verdict: GppPermitVerdict;
  /** The cited permit's opaque id ("GPM-..."), forwarded to the handler and the audit row. */
  permitId: string | null;
  permitRowId: string | null;
  bindingId: string | null;
  /**
   * The handle of the permit minted for THIS call (PR-D), for the caller to
   * cite or replay; null when nothing was minted. Never the presented handle.
   */
  handle: string | null;
  detail: Record<string, unknown>;
};

function presentedHandle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const handle = value.trim();
  if (!handle || handle.length > MAX_PERMIT_HANDLE_LENGTH) return null;
  return handle;
}

/** `failed` tells an infrastructure fault apart from an unknown handle (PR-E never refuses on a fault). */
async function findPresented(
  handle: string,
  parsed: ParsedPermitHandle | null,
): Promise<{ row: PermitRow | null; failed: boolean }> {
  try {
    // A signed handle names its permit; anything else is looked up as a bare
    // permit id (the PR-C opaque handle, and the handle of an unsigned permit).
    return { row: await gppPermitStore().findPermitByPermitId(parsed ? parsed.permitId : handle), failed: false };
  } catch (err) {
    console.error(
      "[gpp-permit] presented-handle lookup failed: %s",
      err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
    );
    return { row: null, failed: true };
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
 * - a gate admitted → a permit is minted and verified (`absent` when the mint
 *   failed);
 * - a handle was presented → that handle's row is verified (an unknown handle
 *   is `absent`).
 *
 * A use is counted when the PR-C state is `valid` and the presentation itself
 * is sound (MAC not invalid, parameters not mismatched). `unsigned` and the
 * lineage verdicts are properties of the install and the ledger, not of the
 * presenter, so they still count the use; a forged or replayed-with-other-
 * arguments presentation never spends the legitimate permit's use.
 */
export async function resolveMonitorPermit(input: MonitorPermitInput): Promise<MonitorPermitOutcome> {
  const binding = bindingForAdmittedCall({
    tool: input.tool,
    alignmentApproved: input.alignmentApproved,
    approvedEnvelopeId: input.approvedEnvelopeId,
  });
  const handle = presentedHandle(input.permitHandle);
  try {
    const minted: MintedPermit | null = binding
      ? await mintShadowPermit({
          binding,
          toolName: input.toolName,
          actorUserId: input.actorUserId,
          actorAgentId: input.actorAgentId,
          workroomId: input.workroomId,
          gateDecisionId: binding.admission === "alignment-approve" ? input.alignmentInteractionId : null,
          authorityDecisionId: input.authorityDecisionId,
          envelopeId: input.approvedEnvelopeId,
          params: input.params,
          now: input.now,
        })
      : null;
    if (!binding && !handle) {
      return { verdict: "ungoverned", permitId: null, permitRowId: null, bindingId: null, handle: null, detail: {} };
    }
    const parsed = handle ? parsePermitHandle(handle) : null;
    const presented = handle ? await findPresented(handle, parsed) : null;
    const evaluated = presented ? presented.row : minted?.row ?? null;
    const call = { toolName: input.toolName, params: input.params, now: input.now };
    const checks = evaluated ? await checkPermit(evaluated, parsed, call) : null;
    const verdict: GppPermitVerdict = checks ? verdictFromChecks(checks) : "absent";
    if (evaluated && checks && checks.state === "valid" && checks.mac !== "invalid" && checks.paramHash !== "mismatch") {
      await consume(evaluated);
    }
    return {
      verdict,
      permitId: evaluated?.permitId ?? null,
      permitRowId: evaluated?.id ?? null,
      bindingId: evaluated?.bindingId ?? binding?.bindingId ?? null,
      handle: minted?.handle ?? null,
      detail: {
        handlePresented: Boolean(handle),
        ...(handle ? { handleFormat: parsed ? "signed" : "bare" } : {}),
        ...(checks ? { checks } : {}),
        ...(binding ? { admittedBy: binding.bindingId, bindingVersion: binding.version } : {}),
        ...(minted && minted.row.id !== evaluated?.id ? { mintedPermitId: minted.row.permitId } : {}),
        ...(binding && !minted ? { mintFailed: true } : {}),
        ...(presented?.failed ? { presentedLookupFailed: true } : {}),
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
      handle: null,
      detail: { resolutionFailed: true },
    };
  }
}
