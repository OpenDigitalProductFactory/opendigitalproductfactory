import { getErrorMessage } from "@/lib/shared/get-error-message";
// apps/web/lib/build/record-ideate-research-receipt.ts
//
// BI-C5D978E9 — the I/O half of the ideate research attestation. The rule for
// WHETHER to attest lives in ideate-research-receipt.ts and is unit-tested
// there; this module only performs the write.

import { prisma } from "@dpf/db";

import { describeResearchAttestation, designDocEvidencesResearch } from "./ideate-research-receipt";

/** The Build Lead coworker holds initiative_evidence_write (initiative-readiness runbook §4). */
export const IDEATE_ATTESTATION_AGENT_ID = "AGT-WS-BUILD";

/**
 * Record the `research` gate receipt for a build's governed backlog subject.
 *
 * No-ops rather than throwing whenever the attestation would not be truthful or
 * the subject is not governed: a build with no backlog originator has no
 * initiative to be ready, and a design with no recorded audit has not done the
 * research the gate asks about.
 */
export async function recordIdeateResearchReceipt(args: {
  buildId: string;
  designDoc: unknown;
  revisionId: string;
  authorUserId: string;
  authorAgentId: string | null;
}): Promise<{ recorded: boolean; reason: string }> {
  if (!designDocEvidencesResearch(args.designDoc)) {
    return { recorded: false, reason: "design document records no research" };
  }

  const build = await prisma.featureBuild.findUnique({
    where: { buildId: args.buildId },
    select: { originator: { select: { itemId: true } } },
  });
  const itemId = build?.originator?.itemId ?? null;
  if (!itemId) return { recorded: false, reason: "build has no governed backlog subject" };

  // BI-9257CF19 follow-up (2026-09-18, FB-6260B711): the receipt writer
  // requires an authenticated reviewer agent, an authority decision and a
  // token scope — the dual-control seam every governed receipt passes. This
  // path used to call the writer with all three null, so it was refused on
  // every build and the refusal was swallowed: 10 of 11 builds in 30 days
  // abandoned in ideate at RESEARCH_REQUIRED. The attestation now runs as a
  // governed tool call by the Build Lead coworker (holder of
  // initiative_evidence_write) on the authoring human's behalf, so the
  // authority gate judges it, records its decision, and the outcome is
  // returned to the caller in words instead of disappearing.
  const { prisma: db } = await import("@dpf/db");
  const author = await db.user.findUnique({
    where: { id: args.authorUserId },
    select: { isSuperuser: true },
  });
  if (!author) return { recorded: false, reason: `authoring user ${args.authorUserId} not found` };
  // The receipt binds to immutable bytes: the latest ACCEPTED designDoc
  // revision of this build (artifact-resolver's feature-build-revision
  // contract). A caller-supplied label such as "review:<build>" is not a
  // revision and used to fail artifact resolution silently.
  const revision = await db.buildArtifactRevision.findFirst({
    where: { buildId: args.buildId, field: "designDoc", status: "accepted" },
    orderBy: [{ revisionNumber: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  });
  if (!revision) return { recorded: false, reason: "build has no accepted designDoc revision to bind the receipt to" };
  // BI-397157EA / EP-WORK-POSTURE: the build runs inside a Workroom, and a
  // room whose resolved action boundary is `preauthorized` is the recorded
  // human decision that lets a coworker's side-effect proceed without a
  // fresh approval envelope (resolveSteering -> "room-authority"). Carry the
  // room's authority on the call; without it the gate can only ask a person,
  // and a build-internal call has no thread to hang the approval envelope on.
  const agentId = args.authorAgentId ?? IDEATE_ATTESTATION_AGENT_ID;
  const room = await db.workroom.findFirst({
    where: { executorKind: "build-studio", executorRef: args.buildId },
    orderBy: { createdAt: "desc" },
    select: { capsuleId: true },
  });
  const roomAuthority = room
    ? await (async () => {
      const [{ loadRoomTurnAuthority }, { toRoomAuthorityContext }] = await Promise.all([
        import("@/lib/work-management/room-turn-authority.server"),
        import("@/lib/work-management/room-turn-authority"),
      ]);
      return toRoomAuthorityContext(await loadRoomTurnAuthority({ agentId, capsuleId: room.capsuleId }));
    })().catch(() => null)
    : null;
  const { governedExecuteTool } = await import("@/lib/mcp-governed-execute");
  const result = await governedExecuteTool({
    toolName: "record_initiative_evidence",
    rawParams: {
      itemId,
      gate: "research",
      decision: "pass",
      artifactRef: { kind: "feature-build-revision", revisionId: revision.id },
      reason: describeResearchAttestation(args.designDoc),
      // Gate-receipt schema: a passing receipt carries empty findings and
      // resolves nothing; omitting the fields is refused as malformed-receipt.
      findings: [],
      resolvedFindingRefs: [],
    },
    userId: args.authorUserId,
    userContext: { userId: args.authorUserId, platformRole: null, isSuperuser: author.isSuperuser },
    source: "agentic-loop",
    context: {
      agentId,
      routeContext: room ? `/build/work/${room.capsuleId}` : "/build",
      featureBuildId: args.buildId,
      tokenScope: "write",
      ...(roomAuthority ? { roomAuthority } : {}),
    },
  });
  if (result.success) return { recorded: true, reason: "research receipt recorded" };
  const rejected = result.governance?.rejected;
  const detail = [result.error, result.message].filter(Boolean).join(": ");
  return {
    recorded: false,
    reason: `${rejected ?? "receipt refused"}${detail ? ` — ${detail}` : ""}`,
  };
}

/**
 * BI-C5D978E9 follow-up: attest the ideate research at REVIEW time, not only at
 * save time.
 *
 * The receipt was recorded in exactly one place — `saveBuildEvidence` with
 * field "designDoc". Any build whose design document was saved by another path,
 * or before that writer shipped, could therefore never obtain the receipt: the
 * reviewer passed, `RESEARCH_REQUIRED` blocked ideate->plan, the stranded-build
 * resumer re-ran the same review, and the build aged out at seven days.
 *
 * Live repro FB-7B4C714B — governed subject BI-CA7C0C48, a 4394-character
 * existingFunctionalityAudit and a 1677-character reusePlan, `reviewDesignDoc`
 * pass, and zero initiative_gate_receipt rows. It is one of 45 abandoned builds.
 *
 * Review is the honest place to attest: the reviewer has just read the document
 * and passed it. The write itself stays truthful — `recordIdeateResearchReceipt`
 * no-ops when the design records no research or the build has no governed
 * subject — so this only ever records what the design actually evidences, and
 * re-running a review is idempotent. Failure never breaks the review.
 */
export async function attestIdeateResearch(
  buildId: string,
  designDoc: unknown,
  userId: string,
  agentId: string | null,
): Promise<void> {
  let outcome: { recorded: boolean; reason: string };
  try {
    const { recordIdeateResearchReceipt } = await import("@/lib/build/record-ideate-research-receipt");
    outcome = await recordIdeateResearchReceipt({
      buildId,
      designDoc,
      revisionId: `review:${buildId}`,
      authorUserId: userId,
      authorAgentId: agentId,
    });
  } catch (err) {
    outcome = { recorded: false, reason: `attestation threw: ${getErrorMessage(err)}` };
  }
  // A missing receipt leaves the build exactly where it already was — but it
  // must never leave it there silently (BI-CA7C0C48: the swallowed refusal is
  // what made ten builds look stuck for no reason). The outcome is a build
  // activity row either way.
  await prisma.buildActivity.create({
    data: {
      buildId,
      tool: "ideate_research_attestation",
      summary: outcome.recorded
        ? "Research receipt recorded for the governed backlog subject (author-accountable lane)."
        : `Research receipt NOT recorded: ${outcome.reason.slice(0, 400)}`,
    },
  }).catch(() => undefined);
}
