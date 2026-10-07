// BI-5B34D277 — every approved run ends with its approval settled.
//
// The authority gate reserves an approved envelope (a compare-and-set on
// `resolvedAt`) before the executor's later checks run: pre-tool hooks, the
// alignment and precondition gates, permit enforcement, and the GAID receipt
// reservation. A refusal there, or an exception, used to return with the
// envelope still reserved: the resolver kept finding it, the next reserve lost
// the compare-and-set, and every retry read "already used" until it expired.
//
// This module is the one place an approved run's reservation is settled:
//   • the tool ran            → finalised executed | failed (settleApprovalRun);
//   • refused before it ran   → decided by the refusal's disposition
//     (governed-rejection-disposition.ts), never a second table:
//       - "refused", a settled no: finalised failed, and the refusal row the
//         executor stamped with this envelope is the recorded outcome a retry
//         gets back;
//       - "inconclusive", "awaiting-input", "awaiting-person": released. Nothing
//         ran and nothing was decided against the request, so the person's
//         approval still stands and a retry may spend it — once, because the
//         reserve compare-and-set is unchanged;
//   • an exception before the tool ran → released (releaseUnsettledApproval).
// A run settles at most once.

import type { GovernedExecuteResult } from "@/lib/mcp-governed-execute-types";

import {
  finalizeCoworkerAuthorityApproval,
  releaseCoworkerAuthorityReservation,
} from "./coworker-tool-authority-gate";
import { GOVERNED_REJECTION_DISPOSITION } from "./governed-rejection-disposition";

export type ApprovalRun = {
  reservation: { envelopeId: string; reservedAt: Date } | null;
  /** True once the reservation is settled, or handed to the tool run to settle. */
  settled: boolean;
};

export function newApprovalRun(): ApprovalRun {
  return { reservation: null, settled: false };
}

function logSettleFailure(action: string, envelopeId: string, toolName: string, err: unknown): void {
  console.error(
    "[governed-execute] approval envelope %s failed envelope=%s tool=%s: %s",
    action,
    JSON.stringify(envelopeId),
    JSON.stringify(toolName),
    err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
  );
}

/** What a refusal before the tool ran does to the approval it reserved. */
export function refusalSettlement(result: GovernedExecuteResult): "failed" | "released" {
  const rejection = result.governance?.rejected;
  return rejection && GOVERNED_REJECTION_DISPOSITION[rejection] === "refused" ? "failed" : "released";
}

/** Settle the reservation for a call refused before its tool ran; returns the refusal unchanged. */
export async function settleApprovalRefusal(
  run: ApprovalRun,
  toolName: string,
  result: GovernedExecuteResult,
): Promise<GovernedExecuteResult> {
  const reservation = run.reservation;
  if (!reservation || run.settled) return result;
  run.settled = true;
  const settlement = refusalSettlement(result);
  try {
    if (settlement === "failed") await finalizeCoworkerAuthorityApproval(reservation.envelopeId, false);
    else await releaseCoworkerAuthorityReservation(reservation.envelopeId, reservation.reservedAt);
  } catch (err) {
    // The refusal is the true answer either way; a settle failure is an
    // evidence defect for reconciliation, never a different outcome.
    logSettleFailure(settlement === "failed" ? "finalization" : "release", reservation.envelopeId, toolName, err);
  }
  return result;
}

/** The tool is about to run: from here the run's own result settles the approval. */
export function handApprovalToToolRun(run: ApprovalRun): void {
  run.settled = true;
}

/** Finalise after the tool ran — executed or failed. Unchanged from the pre-BI-5B34D277 path. */
export async function settleApprovalRun(run: ApprovalRun, toolName: string, success: boolean): Promise<void> {
  const reservation = run.reservation;
  if (!reservation) return;
  try {
    await finalizeCoworkerAuthorityApproval(reservation.envelopeId, success);
  } catch (err) {
    // The action has already run, so this cannot fail closed without
    // misreporting the side effect. Preserve the result and surface the
    // evidence defect in server logs for reconciliation.
    logSettleFailure("finalization", reservation.envelopeId, toolName, err);
  }
}

/** An exception escaped before the tool ran: nothing ran, so give the approval back. */
export async function releaseUnsettledApproval(run: ApprovalRun, toolName: string): Promise<void> {
  const reservation = run.reservation;
  if (!reservation || run.settled) return;
  run.settled = true;
  await releaseCoworkerAuthorityReservation(reservation.envelopeId, reservation.reservedAt)
    .catch((err) => logSettleFailure("release", reservation.envelopeId, toolName, err));
}
