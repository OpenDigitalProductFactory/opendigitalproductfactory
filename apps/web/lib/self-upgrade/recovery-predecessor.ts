import { readFile } from "node:fs/promises";

import {
  INTERRUPTION_TRAIL_PATH,
  classifyInterruption,
} from "@/lib/self-upgrade/interruption-trail";
import { isEligibleRecoveryPredecessor } from "@/lib/self-upgrade/recovery-eligibility";
import { recordInterruptionEvidence } from "@/lib/self-upgrade/run-store";
import { getErrorMessage } from "@/lib/shared/get-error-message";

/** The predecessor shape the eligibility predicate and the trail both need. */
type Candidate = {
  runId: string;
  status: string;
  completedAt: Date | null;
  admissionFingerprint: string | null;
  dispatchStatus: string | null;
  targetSha: string | null;
  targetTag: string | null;
  dispatchAttemptCount: number;
  dispatchAcknowledgedAt: Date | null;
  dispatchEventIds: string[];
  completionEvidence?: unknown;
};

/**
 * BI-41D7A057 — resolve the recovery predecessor for a new upgrade, recording
 * HOW a dispatched failure ended if nobody has established that yet.
 *
 * Eligibility itself is unchanged and stays with
 * `isEligibleRecoveryPredecessor`: only a never-dispatched failure is a typed
 * predecessor, exactly as the exact-target recovery design froze it
 * (AC-SUA-016). A dispatched failure still admits a FRESH run with no
 * `recoveryOfRunId` (AC-SUA-015), so the operator's next click behaves as it
 * does today. Widening the typed lane would have changed that click into a
 * `recovery-binding-required` refusal — a regression on the very path this work
 * exists to protect.
 *
 * What is new is the record. A self-upgrade is orchestrated by the portal it
 * replaces, so when the process dies for a reason that is NOT the swap — a
 * Docker restart, a host reboot, a power cut — the run is reconciled to
 * `failed` with nothing to say how far it got. SUR-E18E0141 ended exactly that
 * way and could not be explained afterwards. `scripts/promote.sh` now writes
 * each step it announces to a host-backed file that outlives the process; this
 * reads it and attaches the verdict to the run.
 *
 * Doing it HERE, lazily, is deliberate. A run interrupted by a power cut is
 * failed by a reconciler in a later process — often several boots later — so
 * there is no moment during the failure at which anything could have been
 * written. The next recovery decision is the first moment that reliably exists,
 * and classifying there means runs that failed BEFORE this shipped are
 * explained from the same evidence as ones that fail after it, with no backfill
 * migration.
 *
 * Best-effort throughout: an upgrade must never be refused because its
 * predecessor's post-mortem could not be written.
 */
export async function resolveRecoveryPredecessor<T extends Candidate>(
  run: T | null,
  deps: {
    readTrail?: () => Promise<string | null>;
    persist?: typeof recordInterruptionEvidence;
    log?: (message: string) => void;
  } = {},
): Promise<T | null> {
  if (!run) return null;
  const eligible = isEligibleRecoveryPredecessor(run) ? run : null;
  if (shouldClassify(run)) {
    await classifyAndRecord(run, deps);
  }
  return eligible;
}

/**
 * Only a dispatched, terminally-failed run with an unexplained ending. A
 * never-dispatched failure needs no trail — its own dispatch record already
 * proves the install was untouched — and re-reading a run that already carries
 * a verdict could flip a recorded "unknown" to "not applied" after the trail
 * rotated past the entry that justified it, the one direction that must never
 * happen silently.
 */
function shouldClassify(run: Candidate): boolean {
  if (run.status !== "failed" || run.completedAt == null) return false;
  if (!run.targetSha) return false;
  if (run.dispatchAttemptCount === 0 && run.dispatchEventIds.length === 0) return false;
  return !hasInterruptionRecord(run.completionEvidence);
}

function hasInterruptionRecord(evidence: unknown): boolean {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return false;
  return "interruption" in (evidence as Record<string, unknown>);
}

async function classifyAndRecord(run: Candidate, deps: {
  readTrail?: () => Promise<string | null>;
  persist?: typeof recordInterruptionEvidence;
  log?: (message: string) => void;
}) {
  const log = deps.log ?? ((message: string) => console.warn(`[self-upgrade] ${message}`));
  try {
    const read = deps.readTrail ?? defaultReadTrail;
    const classification = classifyInterruption(await read(), run.targetSha);
    // Record even an inconclusive verdict. "We looked and could not tell" is
    // what an operator needs when a failure cannot be explained, and it is the
    // absence of exactly that record that left SUR-E18E0141 unexplainable.
    await (deps.persist ?? recordInterruptionEvidence)(run.runId, classification);
    log(
      `interruption-classified: ${run.runId} swapApplied=${classification.swapApplied} ` +
        `basis=${classification.basis} lastStep=${classification.lastStep ?? "none"}`,
    );
  } catch (err) {
    // Never block an upgrade on its predecessor's post-mortem.
    log(`interruption-classify-failed: ${run.runId} ${getErrorMessage(err)}`);
  }
}

/**
 * The trail lives on the portal's read-only state mount. Absent or unreadable
 * is the normal case on an install whose promoter predates the trail, so it
 * resolves to null rather than throwing — no trail means "unknown", which
 * leaves behaviour exactly as it was before this shipped.
 */
async function defaultReadTrail(): Promise<string | null> {
  try {
    return await readFile(INTERRUPTION_TRAIL_PATH, "utf8");
  } catch {
    return null;
  }
}
