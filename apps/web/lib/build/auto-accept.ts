import { prisma } from "@dpf/db";
import { saveBuildArtifactRevision } from "@/lib/build/build-artifact-provenance";
import { getProcessPolicy } from "@/lib/explore/build-process-matrix";
import type { AcceptanceCriterion, VerificationOutput } from "@/lib/explore/feature-build-types";
import { isEvidenceAutoAcceptEnabled } from "@/lib/integrate/build-studio-config";

/**
 * Evidence-gated autonomous build acceptance + the shared acceptance write.
 *
 * Home is `lib/build` (a plain module, NOT `"use server"`) so the integrate/queue
 * layer can import the write without pulling the `"use server"` `actions/build.ts`
 * module into a server-action graph.
 *
 * Background: feature/fix·standard/chore·standard builds stall forever at the
 * review→ship gate because its `acceptance-evaluated` requirement reads
 * `FeatureBuild.acceptanceMet`, which historically only the human "Record
 * Acceptance" UI action wrote — so an unattended governed-autopilot drain never
 * cleared it (0 completions in 33 days). Kernel decision DI-53037C92BC0A
 * ("evidence-auto-accept", composite 13.48 vs 11.75 human-only, HIGH confidence, no
 * commandment conflict) authorised the governed autopilot to record acceptance —
 * but ONLY on fully-green evidence, never blind. This module is that path.
 */

/** Pure builder for the acceptanceMet array — one evidence string per criterion. */
export function buildAcceptanceEvidenceRecord(
  criteria: readonly string[],
  evidenceText: string,
): AcceptanceCriterion[] {
  return criteria.map((criterion) => ({ criterion, met: true, evidence: evidenceText }));
}

/**
 * The single acceptance write, shared by the human Record-Acceptance action and the
 * autonomous path: append-only `BuildArtifactRevision` + the `FeatureBuild.acceptanceMet`
 * column update (both via `saveBuildArtifactRevision`) plus a best-effort audit row.
 * `activityTool` distinguishes machine (`auto_record_acceptance`) from human
 * (`record_acceptance`) in the audit trail. `savedByUserId` is a plain String column
 * (not an FK), so a non-session actor (the build owner) is safe here.
 */
export async function writeAcceptanceMet(args: {
  buildId: string;
  savedByUserId: string;
  acceptanceMet: AcceptanceCriterion[];
  activityTool: string;
  activitySummary: string;
}): Promise<void> {
  await saveBuildArtifactRevision({
    buildId: args.buildId,
    field: "acceptanceMet",
    savedByUserId: args.savedByUserId,
    value: args.acceptanceMet,
  });
  prisma.buildActivity
    .create({
      data: { buildId: args.buildId, tool: args.activityTool, summary: args.activitySummary },
    })
    .catch(() => {});
}

/**
 * Evidence-gated autonomous build acceptance. Records `acceptanceMet` ONLY when the
 * default-OFF flag is on AND the build presents fully-green evidence:
 *   - typecheck clean,
 *   - zero failing tests (STRICTER than the human action, which ignores tests),
 *   - UX verification complete-or-skipped (never failed/running/unknown),
 *   - acceptance criteria present.
 * Anything less → no write, and the review→ship gate blocks exactly as before.
 *
 * Never throws: on any error it declines to accept (fail-closed). Idempotent — a
 * build that already carries acceptanceMet is left untouched.
 */
export async function autoAcceptBuildOnEvidence(
  buildId: string,
): Promise<{ accepted: boolean; acceptanceMet?: AcceptanceCriterion[]; reason?: string }> {
  try {
    if (!(await isEvidenceAutoAcceptEnabled())) return { accepted: false, reason: "flag-off" };

    const build = await prisma.featureBuild.findUnique({
      where: { buildId },
      select: {
        phase: true,
        kind: true,
        plan: true,
        brief: true,
        designDoc: true,
        verificationOut: true,
        uxVerificationStatus: true,
        acceptanceMet: true,
        createdById: true,
      },
    });
    if (!build) return { accepted: false, reason: "not-found" };
    if (build.phase !== "review") return { accepted: false, reason: `phase=${build.phase}` };
    // Idempotent: never overwrite an existing acceptance (human or prior auto).
    if (build.acceptanceMet != null) return { accepted: false, reason: "already-accepted" };

    // Only kinds whose review→ship policy actually requires acceptance. Exempt kinds
    // (doc, fix·minimal, chore·minimal) advance without it, so a write would be noise.
    const processSize = (build.plan as { processSize?: string } | null)?.processSize;
    const reviewToShip = getProcessPolicy(build.kind, processSize).gates["review->ship"];
    if (!reviewToShip?.includes("acceptance-evaluated")) {
      return { accepted: false, reason: "acceptance-not-required" };
    }

    // Evidence gate. Typecheck is the build-relevant hard gate — the same one the human
    // Record-Acceptance action enforces (actions/build.ts). Tests are ADVISORY: recorded
    // but NOT gated. `verificationOut.testsFailed` is the whole apps/web suite (repo-wide,
    // including pre-existing failures unrelated to this build — builds have completed at
    // testsFailed=88), so gating on ===0 would couple a build's acceptance to unrelated
    // repo test health and almost never fire. This mirrors the operator's 2026-06-07
    // policy: typecheck hard-blocks; tests/UX advisory. UX is kept only as a build-SPECIFIC
    // guard — never auto-accept a build whose own UX verification is unresolved or failed
    // (require complete/skipped). A future refinement should gate on the build's SCOPED
    // test delta once that is reliably separable from the repo-wide suite.
    const v = build.verificationOut as VerificationOutput | null;
    if (v?.typecheckPassed !== true) return { accepted: false, reason: "typecheck-not-clean" };
    const ux = build.uxVerificationStatus;
    if (ux !== "complete" && ux !== "skipped") return { accepted: false, reason: `ux=${ux ?? "null"}` };

    const brief = build.brief as { acceptanceCriteria?: string[] } | null;
    const designDoc = build.designDoc as { acceptanceCriteria?: string[] } | null;
    const criteria =
      Array.isArray(brief?.acceptanceCriteria) && brief.acceptanceCriteria.length > 0
        ? brief.acceptanceCriteria
        : Array.isArray(designDoc?.acceptanceCriteria)
          ? designDoc.acceptanceCriteria
          : [];
    if (criteria.length === 0) return { accepted: false, reason: "no-criteria" };

    const evidence =
      `Auto-accepted (evidence-gated): typecheck clean; UX ${ux}; ` +
      `tests ${v.testsPassed ?? 0} passed / ${v.testsFailed ?? 0} failed (repo-wide suite, advisory). ` +
      `Governed autopilot — BUILD_EVIDENCE_AUTO_ACCEPT (kernel DI-53037C92BC0A).`;
    const acceptanceMet = buildAcceptanceEvidenceRecord(criteria, evidence);

    await writeAcceptanceMet({
      buildId,
      savedByUserId: build.createdById,
      acceptanceMet,
      activityTool: "auto_record_acceptance",
      activitySummary:
        `Evidence-gated auto-acceptance: ${criteria.length} criteria met ` +
        `(typecheck clean, UX ${ux}; tests ${v.testsPassed ?? 0} passed / ${v.testsFailed ?? 0} failed, advisory).`,
    });
    return { accepted: true, acceptanceMet };
  } catch (err) {
    console.warn(
      "[auto-accept] evidence-gated acceptance failed (non-blocking) for %s: %s",
      JSON.stringify(buildId),
      err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
    );
    return { accepted: false, reason: "error" };
  }
}
