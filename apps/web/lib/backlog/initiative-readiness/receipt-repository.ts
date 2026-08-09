import { randomUUID } from "node:crypto";

import { Prisma, prisma } from "@dpf/db";

import { resolveInitiativeArtifact } from "./artifact-resolver";
import {
  buildStableInitiativeFindingId,
  validateInitiativeGateReceiptDraft,
  type InitiativeArtifactRef,
  type InitiativeGateKey,
} from "./receipt-schema";

type ReceiptHistoryRow = { payload: unknown };

function currentOpenFindings(rows: ReceiptHistoryRow[], artifactDigest: string): string[] {
  const open = new Set<string>();
  for (const row of rows) {
    if (!row.payload || typeof row.payload !== "object") continue;
    const payload = row.payload as Record<string, unknown>;
    if (payload.artifactDigest !== artifactDigest) continue;
    if (Array.isArray(payload.findingRefs)) {
      for (const ref of payload.findingRefs) if (typeof ref === "string" && ref) open.add(ref);
    }
    if (Array.isArray(payload.resolvedFindingRefs)) {
      for (const ref of payload.resolvedFindingRefs) if (typeof ref === "string") open.delete(ref);
    }
  }
  return [...open].sort();
}

export type RecordInitiativeGateReceiptResult =
  | { ok: true; receiptId: string; receipt: Record<string, unknown> }
  | { ok: false; code: string; error: string };

export async function recordInitiativeGateReceipt(args: {
  itemId: string;
  allowedGates: readonly InitiativeGateKey[];
  requiredCapability: string;
  requiredGrant: string;
  actionKey: string;
  gate: InitiativeGateKey;
  decision: "pass" | "fail" | "not-applicable";
  artifactRef: InitiativeArtifactRef;
  reason: string;
  findings: Array<{ issue: string; severity: "critical" | "important" }>;
  resolvedFindingRefs: string[];
  reviewerUserId: string;
  reviewerAgentId: string | null;
  authorityDecisionId: string | null;
  tokenScope: string | null;
  requiresIndependentReviewer?: boolean;
}): Promise<RecordInitiativeGateReceiptResult> {
  if (args.gate === "spec-approval" && args.decision === "pass") {
    return {
      ok: false,
      code: "OBJECTIVE_BASELINE_REQUIRED",
      error: "Spec approval must use the atomic baseline-and-retention writer; a receipt cannot be recorded by itself.",
    };
  }
  if (!args.reviewerAgentId || !args.authorityDecisionId || !args.tokenScope) {
    return { ok: false, code: "AUTHORIZATION_DENIED", error: "Authenticated reviewer, authority decision, and token scope are required." };
  }
  const tokenScope = args.tokenScope;
  const item = await prisma.backlogItem.findUnique({
    where: { itemId: args.itemId },
    select: { id: true, itemId: true, organizationId: true },
  });
  if (!item) return { ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: `BacklogItem ${args.itemId} was not found.` };

  const authority = await prisma.authorizationDecisionLog.findUnique({
    where: { decisionId: args.authorityDecisionId },
    select: { decisionId: true, decision: true, actionKey: true, policyVersion: true, organizationId: true },
  });
  if (!authority || authority.decision !== "allow" || authority.actionKey !== args.actionKey) {
    return { ok: false, code: "AUTHORIZATION_DENIED", error: "The current tool call has no matching allow decision." };
  }
  if (item.organizationId && authority.organizationId !== item.organizationId) {
    return { ok: false, code: "AUTHORIZATION_DENIED", error: "Reviewer authority does not match the initiative organization." };
  }
  const reviewerAliases = await prisma.principalAlias.findMany({
    where: { aliasType: "user", aliasValue: args.reviewerUserId, issuer: "" },
    select: { principal: { select: { principalId: true } } },
    take: 2,
  });
  const reviewerPrincipalId = reviewerAliases.length === 1 ? reviewerAliases[0]?.principal.principalId : null;
  if (!reviewerPrincipalId) {
    return { ok: false, code: "ARTIFACT_AUTHOR_REQUIRED", error: "Reviewer principal identity is unavailable." };
  }
  const artifact = await resolveInitiativeArtifact({
    locator: args.artifactRef,
    subject: { kind: "backlog-item", id: item.itemId },
    organizationId: authority.organizationId ?? item.organizationId,
  });
  if (!artifact.ok) return artifact;

  const gateKey = args.gate.replaceAll("-", "_") as never;
  const findingRefs = args.findings.map((finding) => buildStableInitiativeFindingId({
    artifactDigest: artifact.artifact.digest,
    gate: args.gate,
    issue: finding.issue,
  }));
  if (findingRefs.length !== new Set(findingRefs).size || args.findings.some((finding) => !finding.issue.trim())) {
    return { ok: false, code: "malformed-receipt", error: "Findings require unique non-empty issues." };
  }
  return prisma.$transaction(async (tx) => {
    // Every receipt writer for a subject serializes on the subject row. Without
    // this seam, a concurrent fail could introduce a blocker after a pass had
    // read history but before either append committed.
    await tx.$queryRaw`SELECT "id" FROM "BacklogItem" WHERE "id" = ${item.id} FOR UPDATE`;
    const history = await tx.backlogItemActivity.findMany({
      where: { backlogItemId: item.id, kind: "initiative_gate_receipt", gateKey },
      orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
      select: { payload: true },
    });
    const receiptId = `initiative-${randomUUID()}`;
    const validated = validateInitiativeGateReceiptDraft({
      gate: args.gate,
      decision: args.decision,
      artifactRef: args.artifactRef,
      reason: args.reason,
      findingRefs,
      resolvedFindingRefs: args.resolvedFindingRefs,
    }, {
      receiptId,
      policyVersion: "initiative-readiness.v1",
      allowedGates: args.allowedGates,
      subject: { kind: "backlog-item", id: item.itemId },
      resolvedArtifact: artifact.artifact,
      reviewerPrincipalId,
      reviewerAgentId: args.reviewerAgentId,
      authorityDecisionId: authority.decisionId,
      authoritySnapshot: {
        decision: "allow",
        effectiveHumanCapability: args.requiredCapability,
        effectiveAgentGrant: args.requiredGrant,
        tokenScope,
        organizationId: authority.organizationId ?? item.organizationId ?? "platform",
        actionKey: args.actionKey,
        policyVersion: authority.policyVersion ?? "coworker-authority.v1",
      },
      openFindingRefs: currentOpenFindings(history, artifact.artifact.digest),
      resolvedFindings: args.findings.map((finding, index) => ({
        findingRef: findingRefs[index]!,
        severity: finding.severity,
        issue: finding.issue.trim(),
      })),
      requiresIndependentReviewer: args.requiresIndependentReviewer,
    });
    if (!validated.ok) return { ok: false, code: validated.code, error: validated.error };

    await tx.backlogItemActivity.create({
      data: {
        id: receiptId,
        backlogItemId: item.id,
        kind: "initiative_gate_receipt",
        gateKey,
        summary: `${args.gate}: ${args.decision}`,
        payload: validated.receipt,
        recordedById: args.reviewerUserId,
        recordedByAgentId: args.reviewerAgentId,
      },
    });
    return { ok: true, receiptId, receipt: validated.receipt as unknown as Record<string, unknown> };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
