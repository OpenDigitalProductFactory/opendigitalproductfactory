/**
 * BI-CE1AB982 — can Build Studio actually dispatch work right now?
 *
 * approveBuildStart used to be unconditional: it stamped draftApprovedAt, told
 * the owner the build was under way, and only THEN discovered — inside a
 * fire-and-forget dispatch — that no engine could run it. The owner was thanked
 * for a decision that changed nothing, and the panel reported progress
 * indefinitely (live repro FB-615DE356).
 *
 * This resolves the same selection the dispatcher will use, so the refusal
 * happens before the owner is asked to authorise anything.
 */

/**
 * Returns the owner-facing blocking action when no allowed healthy Build Studio
 * engine can run the work, or null when dispatch may proceed.
 *
 * Deliberately fails OPEN: an unresolvable readiness check returns null so a
 * broken diagnostic can never strand an owner behind a gate of its own making.
 * Only a definitive `blocked` verdict refuses.
 */
export async function resolveDispatchPreflight(): Promise<string | null> {
  try {
    const { getBuildStudioConfig } = await import("@/lib/build/build-studio-config");
    const { selection } = await getBuildStudioConfig({});
    if (!selection) return null;
    if (selection.status !== "blocked" && selection.selected) return null;
    return selection.action
      ?? selection.reason
      ?? "No allowed healthy Build Studio engine remains. Review AI Readiness and retry.";
  } catch (err) {
    console.warn("[dispatch-preflight] readiness could not be resolved:", err);
    return null;
  }
}
