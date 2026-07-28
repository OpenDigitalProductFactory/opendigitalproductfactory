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

export const NONTERMINAL_LOCAL_CI_GATE_STATUSES = Object.freeze(new Set([
  "admitted",
  "running",
]));

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
  resilience,
  leaseEvents,
  evidencePending = false,
  evidencePendingReason = "",
  quiescence = null,
  recovery = null,
}) {
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
  if (resilience) payload.resilience = resilience;
  if (evidencePending) payload.evidencePendingReason = evidencePendingReason || "unknown";
  if (quiescence) payload.quiescence = quiescence;
  if (recovery) payload.recovery = recovery;
  writeGateStateAtomically(stateFile, `${JSON.stringify(payload, null, 2)}\n`);
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
