export type WorktreeBindingObservation = {
  operation: "create" | "delete" | "loss";
  resourceState: "absent" | "partial" | "present";
  pathVerified: boolean;
  oldWriterFenced: boolean;
  cleanupState: "not-started" | "succeeded" | "failed";
  gitEvidencePreserved: boolean;
};

export type WorktreeBindingRecovery = {
  state: "healthy" | "retryable" | "terminal" | "recovery-required";
  cleanupAllowed: boolean;
  mayActivateReplacement: boolean;
  reason: string;
  metrics: { recoveryOutcome: string; duplicateExecutionCount: number };
};

export function reconcileWorktreeBinding(
  observation: WorktreeBindingObservation,
): WorktreeBindingRecovery {
  const result = (
    state: WorktreeBindingRecovery["state"],
    cleanupAllowed: boolean,
    mayActivateReplacement: boolean,
    reason: string,
    recoveryOutcome: string,
  ): WorktreeBindingRecovery => ({
    state,
    cleanupAllowed,
    mayActivateReplacement,
    reason,
    metrics: { recoveryOutcome, duplicateExecutionCount: 0 },
  });

  if (!observation.pathVerified) {
    return result(
      "recovery-required",
      false,
      false,
      "Refusing cleanup or replacement until the observed worktree path matches the recorded binding.",
      "path-unverified",
    );
  }

  const missingRequiredGitEvidence = !observation.gitEvidencePreserved
    && (observation.operation !== "create" || observation.resourceState !== "absent");
  if (missingRequiredGitEvidence) {
    return result(
      "terminal",
      false,
      false,
      "The partial resource may contain unpreserved Git evidence; operator recovery is required.",
      "evidence-at-risk",
    );
  }

  if ((observation.operation === "delete" || observation.operation === "loss")
    && !observation.oldWriterFenced) {
    return result(
      "recovery-required",
      false,
      false,
      "The old writer must be fenced before a replacement binding can become active.",
      "writer-unfenced",
    );
  }

  if (observation.cleanupState === "failed") {
    return result(
      "terminal",
      false,
      false,
      "Verified cleanup failed; preserve the resource and escalate rather than repeating a destructive operation.",
      "cleanup-failed",
    );
  }

  if (observation.resourceState === "absent" && observation.cleanupState === "succeeded") {
    const fenced = observation.operation === "delete" || observation.operation === "loss";
    return result(
      "retryable",
      true,
      observation.operation === "create" || observation.oldWriterFenced,
      fenced
        ? "The old writer is fenced and Git evidence is preserved; a replacement may be planned."
        : "The partial create was compensated; the same cleanup is now an idempotent no-op.",
      fenced ? "fenced" : "compensated",
    );
  }

  if (observation.resourceState === "partial") {
    return result(
      "retryable",
      true,
      false,
      "A verified partial resource remains; run the idempotent cleanup before retrying.",
      "cleanup-required",
    );
  }

  return result("healthy", false, false, "The recorded and observed binding agree.", "healthy");
}
