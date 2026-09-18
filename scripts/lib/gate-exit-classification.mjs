// scripts/lib/gate-exit-classification.mjs
//
// BI-22E11EA2 — the one place that says what a pregate exit code MEANS.
//
// `pnpm pregate` exits non-zero for several reasons that are not a verdict
// about the diff, and AGENTS.md §4 is explicit about them: "A gate that could
// not run is not a verdict. Infrastructure failure — a fenced lease, a killed
// child, a starved host — is recorded as inconclusive and re-runs on the same
// SHA. Never a FAIL against the diff."
//
// That rule lived only in prose, so every caller re-derived it in bash. Measured
// in one session: four hand-written retry loops, two of which misclassified —
// one abandoned a gate that had merely lost its slot, another reported a
// self-inflicted lease contention as a broken branch.
//
// The codes come from the scripts that emit them; the names are theirs, not
// ours (pregate.mjs, gate-worktree.mjs, lib/sandbox-freshness.mjs).

export const GATE_EXIT = Object.freeze({
  PASS: 0,
  FAILED: 1,
  SANDBOX_DRIFT: 3,
  EVIDENCE_PENDING: 4,
  CONTROL_PLANE_STARVATION: 5,
  ABANDONED_OR_UNRECORDED: 7,
  DURABLE_WAIT: 75,
  CHILD_SIGNAL_DEATH: 87,
  INTERRUPTED: 130,
});

// Exit 1 is the ambiguous one: usually a real gate failure, but the same
// infrastructure class also surfaces there when the lease is lost while waiting
// for the host process fence. Text is the only discriminator available.
const INFRA_TEXT = [
  "lease_lost",
  "lease fenced",
  "process fence held",
  "lease authority lost",
];

/**
 * Classify one pregate invocation.
 *
 * `retry` means "re-run the SAME command on the SAME SHA and it may yet reach a
 * verdict". It is deliberately false for states that need an action first —
 * a drifted sandbox and pending evidence are both non-verdicts, but spinning on
 * them just burns the host.
 *
 * @param {{ code: number|null, output?: string }} input
 * @returns {{ kind: string, retry: boolean, verdict: "pass"|"fail"|"none", summary: string, next?: string }}
 */
export function classifyGateExit({ code, output = "" }) {
  const text = String(output);
  switch (code) {
    case GATE_EXIT.PASS:
      return { kind: "pass", retry: false, verdict: "pass", summary: "gate passed" };
    case GATE_EXIT.DURABLE_WAIT:
      return { kind: "queued", retry: true, verdict: "none", summary: "queued behind the shared local-integration-ci lease" };
    case GATE_EXIT.CONTROL_PLANE_STARVATION:
      return { kind: "starved", retry: true, verdict: "none", summary: "lease fenced or control plane starved before the run finished" };
    case GATE_EXIT.CHILD_SIGNAL_DEATH:
      return { kind: "child-signal-death", retry: true, verdict: "none", summary: "the gate's child process was killed — a loaded host, not the diff" };
    case GATE_EXIT.ABANDONED_OR_UNRECORDED:
      return { kind: "did-not-run", retry: true, verdict: "none", summary: "the admission window elapsed without gating — nothing was verified" };
    case GATE_EXIT.SANDBOX_DRIFT:
      return {
        kind: "sandbox-drift", retry: false, verdict: "none",
        summary: "BLOCKED on sandbox drift — a sandbox defect, not build evidence about this diff",
        next: "converge the sandbox, then re-run the gate",
      };
    case GATE_EXIT.EVIDENCE_PENDING:
      return {
        kind: "evidence-pending", retry: false, verdict: "pass",
        summary: "the gate PASSED but evidence recording is pending because the portal is quiescing",
        next: 'pnpm run pregate -- --finalize-evidence --branch <branch> --sha <sha> --worktree <path>',
      };
    case GATE_EXIT.INTERRUPTED:
      return { kind: "interrupted", retry: false, verdict: "none", summary: "interrupted" };
    default:
      break;
  }
  if (code === GATE_EXIT.FAILED && INFRA_TEXT.some((m) => text.includes(m))) {
    return {
      kind: "lease-lost", retry: true, verdict: "none",
      summary: "the lease was lost while waiting for the host process fence — infrastructure, not the diff",
    };
  }
  return { kind: "failed", retry: false, verdict: "fail", summary: `gate failed (exit ${code})` };
}
