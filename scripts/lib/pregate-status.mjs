// scripts/lib/pregate-status.mjs
//
// BI-B1065D41 Phase 2 — ONE authoritative verdict artifact, and one command
// that reads it.
//
// Every convenient signal this gate exposes lies in a documented direction:
//
//   - the EXIT CODE lies twice over. `pnpm run pregate ...; echo EXIT=$?; tail`
//     reports tail's status, and a run that gave up while queued exits 0 having
//     gated nothing at all (BI-2C7F51BA Defect 3).
//   - the LOG TAIL lies. A TOLERATED GuardRuntimeEnvironmentError prints
//     `Error:` and a red cross roughly 28,000 lines before a PASSING verdict, so
//     a watcher grepping for `Error:` fabricates a failure that never happened.
//   - even `^gate passed` is only a claim about the run you happened to watch;
//     it says nothing about whether HEAD has moved since.
//
// The records do not lie: `dpf-local-ci-gate.json` (the gate's own SHA-bound
// state) and the schema-versioned `dpf-local-ci-metadata.json` written by
// scripts/local-integration-ci.mjs. Both already existed. What was missing was a
// command that reads them and states a verdict, so this module is deliberately
// a READER — it computes nothing the gate did not already record.
//
// This is the first instance of a durable rule the BI generalizes: every gate
// exposes ONE authoritative verdict artifact plus a command that reads it, and
// the convenient-but-lying signals are made either correct or unavailable. The
// other known instances (bare tsc printing "0 errors" after an OOM,
// --test-force-exit masking late rejections, Policy Guards' tail vs its
// --results JSON, `gh pr checks` never showing merge_group failures) are a
// follow-on sweep, not this file's business.
//
// Pure aside from injected readers, so the verdict logic unit-tests without a
// gate run or a filesystem.

/** Terminal verdicts, ordered worst-to-best for slot reconciliation. */
export const PREGATE_VERDICTS = Object.freeze([
  "NO-RECORD",
  "FAIL",
  "STALE",
  "PENDING",
  "PASS",
]);

function rank(verdict) {
  const index = PREGATE_VERDICTS.indexOf(verdict);
  return index < 0 ? -1 : index;
}

/**
 * Classify ONE slot's records against the current HEAD.
 *
 * `state` is the parsed dpf-local-ci-gate.json; `metadata` the parsed
 * dpf-local-ci-metadata.json (either may be null when absent/unreadable).
 *
 * The SHA comparison is the point of the whole command. A record that passed for
 * a commit you have since amended or rebased past is not evidence for what you
 * are about to push, and that distinction is invisible in both the exit code and
 * the log.
 *
 * @param {{
 *   state: any, metadata: any, headSha: string, headBranch?: string, now?: number,
 * }} input
 * @returns {{ verdict: string, reason: string, boundSha: string, boundBranch: string,
 *             candidateSha: string, staleness: string, evidenceId: string,
 *             recordedAt: string, expiresAt: string }}
 */
/**
 * BI-465B3D60. A failing gate record carries `status: "failed"`, `gatePassed:
 * false`, and — in the observed cases — no failureReason, no error, and no
 * failedCommand. `pnpm run pregate:status` could only say "this SHA has not
 * passed", which reads as "your code is bad" when the actual event was losing a
 * contended slot.
 *
 * That matters because local-integration-ci runs at effectiveCapacity 1 on a
 * host that may have several sessions gating at once. A run that queued,
 * started, and was released early is a RETRY, not a verdict on the diff.
 *
 * This is a reader, so it cannot fix the missing reason. It can stop presenting
 * absence as a finding, and name the lease outcome the record does carry.
 */
function describeFailure(state, metadata) {
  const status = state?.status || "unknown";
  // Never quote a metadata record that does not describe THIS run. The gate state
  // is written by the wrapper and is always current; the metadata is written by
  // the sandbox run and a failing run may never rewrite it. Serving the previous
  // run's failedCommand as this run's cause is worse than admitting the cause was
  // not recorded — a confident wrong answer is acted on, an honest absence is
  // re-run. The gate state's own fields stay usable either way.
  const metadataIsForThisRun = !metadataDescribesAnotherRun(state, metadata);
  const stated = state?.failureReason
    || state?.error
    || (metadataIsForThisRun ? metadata?.execution?.failedCommand : null);
  if (stated) return `gate record status ${status} — ${typeof stated === "string" ? stated : "see the gate record"}`;
  if (!metadataIsForThisRun) {
    return `gate record status ${status} with NO recorded reason for THIS run — the metadata file on disk describes a previous run, so it is not evidence about this one. Re-run pregate; do not treat this as a verdict on the diff.`;
  }

  const events = Array.isArray(state?.leaseEvents) ? state.leaseEvents : [];
  const started = events.some((e) => e?.type === "started");
  const queued = events.some((e) => e?.type === "queued");
  const replaced = events.some((e) => e?.type === "terminal-claim-replaced");

  if (started && !stated) {
    const suffix = queued || replaced
      ? " The run held the slot and was released without recording a failing command, and this claim queued behind another session — a contended slot is a retry, not a verdict on your diff."
      : " The run started and was released without recording a failing command, so this is not evidence that the diff is bad.";
    return `gate record status ${status} with NO recorded reason — re-run before treating this as a real failure.${suffix}`;
  }

  return `gate record status ${status} with NO recorded reason — this SHA has not passed, but the record does not say why. Re-run pregate.`;
}

/**
 * The two records are written by different processes, and the failing runs
 * observed in BI-465B3D60 never rewrote dpf-local-ci-metadata.json at all — so
 * it kept reporting the PREVIOUS run's `execution.status: "passed"`. Reading it
 * after a failure yields a confident, wrong "it passed"; only the file mtime
 * gave it away.
 *
 * Presence of the file was always checked. Freshness never was.
 *
 * The SHA comparison alone was not enough (BI-465B3D60, second recurrence).
 * Re-running the gate on an UNCHANGED commit produces runs whose candidateSha is
 * identical by construction, so the SHAs match and this returns false while the
 * metadata still describes a previous run. Observed live: four runs on
 * efeb0a5a6845, three recorded failed and one passed, and the failing verdicts
 * quoted a failedCommand from a metadata file 53 minutes older than the gate
 * record. That sent the reader chasing a cause the run's own artifacts had
 * already falsified.
 *
 * The lease is per-run, so it is the identity that actually separates two runs
 * on one commit. Prefer it; fall back to the SHA when either side predates the
 * stamp (an older metadata file has no runLeaseId, and an ungoverned run has no
 * lease at all) so this never reports a false mismatch on a record that simply
 * cannot answer.
 */
function metadataDescribesAnotherRun(state, metadata) {
  const boundLease = String(state?.leaseId || "");
  const metadataLease = String(metadata?.runLeaseId || "");
  if (boundLease && metadataLease) return boundLease !== metadataLease;

  const boundSha = String(state?.sha || "");
  const candidateSha = String(metadata?.candidateSha || "");
  if (!boundSha || !candidateSha) return false;
  if (boundSha === candidateSha) return false;
  return true;
}

export function classifySlotRecord({ state, metadata, headSha, headBranch = "", now = Date.now() }) {
  const boundSha = String(state?.sha || "");
  const boundBranch = String(state?.branch || "");
  const candidateSha = String(metadata?.candidateSha || "");
  const evidenceId = String(state?.evidenceRecordId || "");
  const recordedAt = String(state?.recordedAt || "");
  const expiresAt = String(state?.expiresAt || "");
  const base = { boundSha, boundBranch, candidateSha, evidenceId, recordedAt, expiresAt, staleness: "" };

  if (!state) {
    return { ...base, verdict: "NO-RECORD", reason: "no gate record for this worktree — pregate has not run here" };
  }

  // A record for a DIFFERENT commit is not weaker evidence for HEAD; it is no
  // evidence for HEAD. Report it as STALE and name both SHAs so the operator can
  // see whether they amended, rebased, or simply committed since gating.
  if (headSha && boundSha && boundSha !== headSha) {
    return {
      ...base,
      verdict: "STALE",
      reason: `gate record is bound to ${boundSha.slice(0, 12)} but HEAD is ${headSha.slice(0, 12)} — re-run pregate`,
      staleness: "head-moved",
    };
  }
  if (headBranch && boundBranch && boundBranch !== headBranch) {
    return {
      ...base,
      verdict: "STALE",
      reason: `gate record is bound to branch ${boundBranch} but HEAD is on ${headBranch} — re-run pregate`,
      staleness: "branch-moved",
    };
  }

  if (state.evidencePending === true) {
    return {
      ...base,
      verdict: "PENDING",
      reason: `gate passed but evidence publication is pending (${state.evidencePendingReason || "unknown"}) — finish with: pnpm run pregate -- --finalize-evidence`,
    };
  }

  if (state.gatePassed !== true) {
    return {
      ...base,
      verdict: "FAIL",
      reason: describeFailure(state, metadata),
      staleness: metadataDescribesAnotherRun(state, metadata) ? "metadata-describes-another-run" : "",
    };
  }

  if (expiresAt) {
    const expiry = Date.parse(expiresAt);
    if (Number.isFinite(expiry) && expiry < now) {
      return {
        ...base,
        verdict: "STALE",
        reason: `gate record expired at ${expiresAt} — re-run pregate`,
        staleness: "expired",
      };
    }
  }

  // The gate state says passed; cross-check the independent metadata record.
  // These are written by different processes (the wrapper vs the sandbox run),
  // so a disagreement means one of them is not describing this run.
  if (candidateSha && headSha && candidateSha !== headSha) {
    return {
      ...base,
      verdict: "STALE",
      reason: `metadata record gated ${candidateSha.slice(0, 12)}, not HEAD ${headSha.slice(0, 12)} — re-run pregate`,
      staleness: "metadata-mismatch",
    };
  }

  return { ...base, verdict: "PASS", reason: "gate passed for this HEAD" };
}

/**
 * Reconcile every slot into one verdict for the worktree.
 *
 * Two slots exist (BI-4BE30454) and only one of them ran your gate, so the other
 * legitimately holds an older record. Taking the BEST verdict is correct: a PASS
 * bound to this exact HEAD is proof regardless of which slot produced it, and a
 * sibling slot's stale record must not be able to report a false FAIL.
 *
 * @param {Array<{ slotKey: string } & ReturnType<typeof classifySlotRecord>>} slots
 */
export function reconcileSlots(slots) {
  const considered = slots.filter(Boolean);
  if (considered.length === 0) {
    return { verdict: "NO-RECORD", reason: "no local-CI slots were readable", slot: null };
  }
  let best = considered[0];
  for (const slot of considered.slice(1)) {
    if (rank(slot.verdict) > rank(best.verdict)) best = slot;
  }
  return { ...best, slot: best.slotKey ?? null };
}

/** Exit code contract: 0 ONLY for a PASS bound to the current HEAD. */
export function exitCodeForVerdict(verdict) {
  return verdict === "PASS" ? 0 : 1;
}

function ageText(iso, now) {
  const at = Date.parse(iso || "");
  if (!Number.isFinite(at)) return "";
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Render the verdict as the whole answer — short enough that nobody pipes it.
 * @param {{ verdict: string, reason: string, slot?: string|null, boundBranch?: string,
 *           boundSha?: string, candidateSha?: string, evidenceId?: string,
 *           recordedAt?: string, logFile?: string }} result
 * @param {{ headBranch: string, headSha: string, now?: number }} head
 * @returns {string[]}
 */
export function formatStatusReport(result, { headBranch, headSha, now = Date.now() }) {
  const lines = [];
  lines.push(`local-CI gate: ${result.verdict}`);
  lines.push(`  reason      ${result.reason}`);
  lines.push(`  HEAD        ${headBranch || "(unknown)"} @ ${(headSha || "").slice(0, 12) || "(unknown)"}`);
  if (result.boundSha) {
    const age = ageText(result.recordedAt, now);
    lines.push(
      `  gated       ${result.boundBranch || "(unknown)"} @ ${result.boundSha.slice(0, 12)}`
      + (age ? ` (${age})` : ""),
    );
  }
  if (result.candidateSha && result.candidateSha !== result.boundSha) {
    lines.push(`  metadata    candidateSha ${result.candidateSha.slice(0, 12)}`);
  }
  if (result.slot) lines.push(`  slot        ${result.slot}`);
  if (result.evidenceId) lines.push(`  evidence    ${result.evidenceId}`);
  if (result.logFile) lines.push(`  full log    ${result.logFile}`);
  if (result.verdict !== "PASS") {
    lines.push("  next        pnpm run pregate   (foreground, unpiped, as the sole command)");
  }
  return lines;
}
