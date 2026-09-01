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
  writeGateStateAtomically(stateFile, `${JSON.stringify(payload, null, 2)}\n`);
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
