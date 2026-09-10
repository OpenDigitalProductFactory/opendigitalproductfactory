import { randomUUID } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { createCiEvidenceValidity } from "./evidence-validity-policy.mjs";

export const NONTERMINAL_LOCAL_CI_GATE_STATUSES = Object.freeze(new Set([
  "queued",
  "admitted",
  "running",
]));

/**
 * BI-FFCFCCE0. Is `status` an infrastructure observation rather than a verdict
 * about the diff?
 *
 * A `blocked_*` status is INFRASTRUCTURE evidence, never a product verdict -
 * local-integration-status.mjs and pregate-status.mjs both already say so in
 * those words. Encode that rule by its prefix rather than as a fourth copy of a
 * status list: BI-C59AC8AF cost a permanently ungateable tree precisely because
 * four copies of one status set drifted apart, and this predicate must stay
 * right for a `blocked_*` status nobody has written yet.
 *
 * `failed` and `conflict` are verdicts about the tree and stay free to replace a
 * stale PASS.
 */
export function isInconclusiveLocalCiGateStatus(status) {
  return typeof status === "string" && status.startsWith("blocked_");
}

/** The most inconclusive observations one record keeps before dropping the oldest. */
const MAX_INCONCLUSIVE_OBSERVATIONS = 20;

/** True when `state` is a PASS this gate actually reached, pending evidence or not. */
export function isTerminalPassRecord(state) {
  return Boolean(state)
    && typeof state === "object"
    && state.gatePassed === true
    && state.status === "passed";
}

export function createLocalCiPassEvidenceValidity(options) {
  return createCiEvidenceValidity(options);
}

export function readLocalCiGateState(stateFile) {
  if (!stateFile) return null;
  try {
    return JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return null;
  }
}

export function isRecoverableInterruptedGateState(state, { branch = "", sha = "" } = {}) {
  if (!state || typeof state !== "object") return false;
  if (branch && state.branch !== branch) return false;
  if (sha && state.sha !== sha) return false;
  if (!state.leaseId || typeof state.leaseId !== "string") return false;
  if (state.evidencePending === true) return false;
  return NONTERMINAL_LOCAL_CI_GATE_STATUSES.has(state.status);
}

export function writeLocalCiGateState(stateFile, {
  branch,
  sha,
  gatePassed,
  leaseId,
  evidenceId,
  status,
  expiresAt,
  leaseExpiresAt = "",
  evidenceValidity = null,
  resilience,
  leaseEvents,
  evidencePending = false,
  evidencePendingReason = "",
  quiescence = null,
  recovery = null,
  queueObserver = null,
  admission = null,
  failureReason = "",
  failureSummary = null,
  childExitCode = null,
}) {
  const previous = readLocalCiGateState(stateFile);
  // BI-FFCFCCE0. A verdict that was reached and reported must not be erased by
  // an infrastructure event that arrives after the run finished. Observed
  // 2026-09-10 on fix/principle-decide-requires-option-id: the gate PASSED at
  // 05:55Z on lease NPEL-50DF305E6C, and at 06:15Z the same slot record was
  // rewritten to blocked_control_plane_starvation with gatePassed:false and an
  // empty evidenceRecordId. One lease, one run - nothing re-tested the tree, so
  // nothing had the standing to withdraw the PASS.
  //
  // The event is still recorded, as its own inconclusive observation on the
  // surviving record rather than as the record's status. This mirrors the guards
  // supersedeLosingSlotRecords already applies to a SIBLING slot's pass
  // (BI-5529B5AC): until now a sibling's PASS was protected and the record's own
  // was not.
  if (
    isInconclusiveLocalCiGateStatus(status)
    && isTerminalPassRecord(previous)
    && previous.branch === branch
    && previous.sha === sha
  ) {
    const observations = [
      ...(Array.isArray(previous.inconclusiveObservations) ? previous.inconclusiveObservations : []),
      {
        status,
        at: new Date().toISOString(),
        leaseId: leaseId || null,
        reason: failureReason || evidencePendingReason || null,
      },
    ].slice(-MAX_INCONCLUSIVE_OBSERVATIONS);
    writeGateStateAtomically(
      stateFile,
      serializeGateState({ ...previous, inconclusiveObservations: observations }),
    );
    return { written: false, preservedPass: true, status: previous.status };
  }
  const retainedAdmission = admission ?? (
    previous?.branch === branch && previous?.sha === sha
      ? previous.admission ?? null
      : null
  );
  mkdirSync(dirname(stateFile), { recursive: true });
  const payload = {
    branch,
    sha,
    gatePassed,
    leaseId,
    evidenceRecordId: evidenceId,
    status,
    expiresAt,
    leaseEvents,
    evidencePending,
    recordedAt: new Date().toISOString(),
  };
  if (leaseExpiresAt) payload.leaseExpiresAt = leaseExpiresAt;
  if (evidenceValidity) payload.evidenceValidity = evidenceValidity;
  if (resilience) payload.resilience = resilience;
  if (evidencePending) payload.evidencePendingReason = evidencePendingReason || "unknown";
  if (quiescence) payload.quiescence = quiescence;
  if (recovery) payload.recovery = recovery;
  if (queueObserver) payload.queueObserver = queueObserver;
  if (retainedAdmission) payload.admission = retainedAdmission;
  // BI-DBED32FE / BI-465B3D60: a failed or blocked record that cannot name
  // its cause teaches people to re-run (or skip) the gate. Persist the
  // structured summary so `pregate:status` can quote THIS run.
  if (failureReason) payload.failureReason = failureReason;
  if (failureSummary) payload.failureSummary = failureSummary;
  if (childExitCode !== null && childExitCode !== undefined) payload.childExitCode = childExitCode;
  writeGateStateAtomically(stateFile, serializeGateState(payload));
  return { written: true, preservedPass: false, status };
}

/**
 * BI-5529B5AC. Gate state is per slot. When one slot PASSES a branch+SHA, a
 * sibling slot's non-passing record for the SAME branch+SHA is a loser — an
 * earlier attempt that queued, was blocked, failed on a contended slot, or was
 * overridden — and left alone it lingers as a live-looking claim that shadows
 * the real PASS in every reader that opens one file. Rewrite it as
 * `superseded`, naming the winner, so no reader can mistake it for a verdict.
 *
 * Only exact branch+SHA matches are touched. A real PASS, a PASS whose evidence
 * is still pending, a record for another SHA or branch, and a missing file are
 * all left as they are.
 *
 * @returns {{ superseded: string[], skipped: Array<{ file: string, reason: string }> }}
 */
export function supersedeLosingSlotRecords({
  winnerStateFile,
  winnerSlotKey,
  siblingStateFiles,
  branch,
  sha,
  now = () => new Date().toISOString(),
}) {
  const superseded = [];
  const skipped = [];
  for (const file of siblingStateFiles || []) {
    if (!file || file === winnerStateFile) continue;
    const state = readLocalCiGateState(file);
    if (!state) { skipped.push({ file, reason: "no-record" }); continue; }
    if (state.branch !== branch || state.sha !== sha) { skipped.push({ file, reason: "other-candidate" }); continue; }
    if (state.gatePassed === true) { skipped.push({ file, reason: "is-a-pass" }); continue; }
    if (state.evidencePending === true) { skipped.push({ file, reason: "evidence-pending" }); continue; }
    if (state.status === "superseded") { skipped.push({ file, reason: "already-superseded" }); continue; }
    const payload = {
      ...state,
      gatePassed: false,
      status: "superseded",
      supersededStatus: state.status ?? null,
      supersededBy: { slotKey: winnerSlotKey, stateFile: winnerStateFile, at: now() },
    };
    writeGateStateAtomically(file, `${JSON.stringify(payload, null, 2)}
`);
    superseded.push(file);
  }
  return { superseded, skipped };
}

/**
 * BI-C6B2D404. Canonical PASS reuse must project the CURRENT candidate onto
 * the metadata record. Updating only dpf-local-ci-gate.json leaves
 * candidateSha pointing at the prior run, and pregate:status then reports
 * STALE for an identical tested tree.
 */
export function projectReusedPassMetadata(prior, { sha, branch, evidenceId, leaseId }) {
  const previous = prior && typeof prior === "object" ? prior : {};
  const previousExecution = previous.execution && typeof previous.execution === "object"
    ? previous.execution
    : {};
  return {
    ...previous,
    candidateRef: branch,
    candidateSha: sha,
    reusedEvidenceId: evidenceId,
    runLeaseId: leaseId || previous.runLeaseId || null,
    execution: {
      ...previousExecution,
      status: "passed",
      failedCommand: null,
    },
  };
}

function serializeGateState(payload) {
  return `${JSON.stringify(payload, null, 2)}
`;
}

function writeGateStateAtomically(stateFile, contents) {
  const directory = dirname(stateFile);
  mkdirSync(directory, { recursive: true });
  const tempFile = join(directory, `.${basename(stateFile)}.${process.pid}.${randomUUID()}.tmp`);
  let fd = null;
  try {
    fd = openSync(tempFile, "wx", 0o600);
    writeFileSync(fd, contents, { encoding: "utf8" });
    closeSync(fd);
    fd = null;
    renameSync(tempFile, stateFile);
  } catch (error) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // Best-effort cleanup below handles the temp path.
      }
    }
    try {
      unlinkSync(tempFile);
    } catch {
      // The temp file may not exist if open failed.
    }
    throw error;
  }
}
