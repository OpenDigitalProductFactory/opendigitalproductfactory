import { randomUUID } from "node:crypto";
import { validateInitiativeDisposition } from "./disposition-contract";

import { Prisma, prisma } from "@dpf/db";

import { writeDocumentBlob } from "@/lib/documents/blob-storage";
import { resolveInitiativeArtifact } from "./artifact-resolver";
import type { InitiativeScopeManifestResult } from "./baseline-manifest";
import { diffInitiativeScopeManifests, parseInitiativeScopeManifest } from "./baseline-manifest";
import { deriveAuthoritativeReadinessProfile } from "./profiles";
import type {
  InitiativeArtifactRef,
  InitiativeAuthoritySnapshot,
  InitiativeGateDecision,
  InitiativeGateKey,
} from "./receipt-schema";
import { validateInitiativeGateReceiptDraft } from "./receipt-schema";
import type { InitiativeSubject, ReadinessProfile } from "./types";
import { resolveReviewerIdentity } from "./reviewer-identity";

export type InitiativeBaselineChainEntry = {
  baselineId: string;
  supersedesBaselineId: string | null;
};

export type InitiativeBaselineChainValidation =
  | { ok: true; currentBaselineId: string | null }
  | { ok: false; code: "CANONICAL_DESIGN_AMBIGUOUS"; error: string };

export function validateInitiativeBaselineChainHead(
  entries: readonly InitiativeBaselineChainEntry[],
  expectedCurrentBaselineId: string | null,
): InitiativeBaselineChainValidation {
  const ids = new Set(entries.map((entry) => entry.baselineId));
  if (ids.size !== entries.length
    || entries.some((entry) => entry.supersedesBaselineId && !ids.has(entry.supersedesBaselineId))) {
    return { ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS", error: "The baseline chain is malformed." };
  }
  const superseded = new Set(entries.map((entry) => entry.supersedesBaselineId).filter((id): id is string => Boolean(id)));
  const heads = entries.filter((entry) => !superseded.has(entry.baselineId));
  if ((entries.length > 0 && heads.length !== 1) || (entries.length === 0 && heads.length !== 0)) {
    return { ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS", error: "The subject has an ambiguous baseline head." };
  }
  const currentBaselineId = heads[0]?.baselineId ?? null;
  if (currentBaselineId !== expectedCurrentBaselineId) {
    return { ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS", error: "The expected baseline is not the current chain head." };
  }
  return { ok: true, currentBaselineId };
}

export type InitiativeApprovalReceiptBinding = {
  receiptId: string;
  gate: InitiativeGateKey;
  decision: InitiativeGateDecision;
  subject: InitiativeSubject;
  artifactRef: InitiativeArtifactRef;
  artifactDigest: string;
  authoritySnapshot: InitiativeAuthoritySnapshot;
};

export type RetainedInitiativeArtifact =
  | { sourceKind: "build-artifact-revision"; buildArtifactRevisionId: string }
  | { sourceKind: "document-version"; documentVersionId: string; documentBlobId: string | null }
  | { sourceKind: "repository-blob-archive"; documentVersionId: string; documentBlobId: string };

export type InitiativeScopeBaseline = {
  schemaVersion: 1;
  baselineId: string;
  subject: InitiativeSubject;
  profile: ReadinessProfile;
  artifactRole: "design-spec" | "problem-statement" | "documentation-scope";
  artifactRef: InitiativeArtifactRef;
  artifactDigest: string;
  objectiveStatements: Extract<InitiativeScopeManifestResult, { ok: true }>["objectives"];
  acceptanceStatements: Extract<InitiativeScopeManifestResult, { ok: true }>["acceptance"];
  supersedesBaselineId: string | null;
  supersessionDispositions?: Array<{ statementId: string; reason: string }>;
  approvalReceiptId: string;
  authoritySnapshot: InitiativeAuthoritySnapshot;
};

type InitiativeRetentionPinDraft = RetainedInitiativeArtifact & {
  baselineActivityId: string;
  artifactDigest: string;
  artifactLocator: InitiativeArtifactRef;
};

function artifactRefsEqual(left: InitiativeArtifactRef, right: InitiativeArtifactRef): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "feature-build-revision" && right.kind === left.kind) return left.revisionId === right.revisionId;
  if (left.kind === "document-version" && right.kind === left.kind) return left.versionId === right.versionId;
  if (left.kind === "repo-blob-at-commit" && right.kind === left.kind) {
    return left.repositoryFullName === right.repositoryFullName
      && left.commitSha === right.commitSha
      && left.path === right.path
      && left.providerBlobId === right.providerBlobId;
  }
  return false;
}

function subjectsEqual(left: InitiativeSubject, right: InitiativeSubject): boolean {
  return left.kind === right.kind && left.id === right.id;
}

export function buildInitiativeBaselineAndPin(args: {
  baselineId: string;
  baselineActivityId: string;
  subject: InitiativeSubject;
  profile: ReadinessProfile;
  artifactRole: InitiativeScopeBaseline["artifactRole"];
  artifactRef: InitiativeArtifactRef;
  artifactDigest: string;
  manifest: Extract<InitiativeScopeManifestResult, { ok: true }>;
  supersedesBaselineId: string | null;
  supersessionDispositions?: Array<{ statementId: string; reason: string }>;
  approvalReceipt: InitiativeApprovalReceiptBinding;
  retainedArtifact: RetainedInitiativeArtifact;
}):
  | { ok: true; baseline: InitiativeScopeBaseline; pin: InitiativeRetentionPinDraft }
  | { ok: false; code: "CANONICAL_DESIGN_AMBIGUOUS"; error: string } {
  const approval = args.approvalReceipt;
  if (approval.gate !== "spec-approval" || approval.decision !== "pass"
    || !subjectsEqual(approval.subject, args.subject)
    || !artifactRefsEqual(approval.artifactRef, args.artifactRef)
    || approval.artifactDigest !== args.artifactDigest
    || args.manifest.artifactDigest !== args.artifactDigest) {
    return { ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS", error: "Approval, manifest, subject, and artifact binding must match exactly." };
  }
  const retained = args.retainedArtifact;
  const shapeMatches = (args.artifactRef.kind === "feature-build-revision"
      && retained.sourceKind === "build-artifact-revision"
      && retained.buildArtifactRevisionId === args.artifactRef.revisionId)
    || (args.artifactRef.kind === "document-version"
      && retained.sourceKind === "document-version"
      && retained.documentVersionId === args.artifactRef.versionId)
    || (args.artifactRef.kind === "repo-blob-at-commit"
      && retained.sourceKind === "repository-blob-archive");
  if (!shapeMatches) {
    return { ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS", error: "Retention pin does not preserve the approved artifact branch." };
  }
  return {
    ok: true,
    baseline: {
      schemaVersion: 1,
      baselineId: args.baselineId,
      subject: args.subject,
      profile: args.profile,
      artifactRole: args.artifactRole,
      artifactRef: args.artifactRef,
      artifactDigest: args.artifactDigest,
      objectiveStatements: args.manifest.objectives,
      acceptanceStatements: args.manifest.acceptance,
      supersedesBaselineId: args.supersedesBaselineId,
      supersessionDispositions: args.supersessionDispositions ?? [],
      approvalReceiptId: approval.receiptId,
      authoritySnapshot: approval.authoritySnapshot,
    },
    pin: {
      ...retained,
      baselineActivityId: args.baselineActivityId,
      artifactDigest: args.artifactDigest,
      artifactLocator: args.artifactRef,
    },
  };
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function baselineEntries(rows: Array<{ payload: unknown }>): InitiativeBaselineChainEntry[] | null {
  const entries: InitiativeBaselineChainEntry[] = [];
  for (const row of rows) {
    if (!row.payload || typeof row.payload !== "object" || Array.isArray(row.payload)) return null;
    const payload = row.payload as Record<string, unknown>;
    if (typeof payload.baselineId !== "string") return null;
    if (payload.supersedesBaselineId !== null && typeof payload.supersedesBaselineId !== "string") return null;
    entries.push({
      baselineId: payload.baselineId,
      supersedesBaselineId: payload.supersedesBaselineId as string | null,
    });
  }
  return entries;
}

function manifestFromBaseline(payload: unknown): Extract<InitiativeScopeManifestResult, { ok: true }> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const row = payload as Partial<InitiativeScopeBaseline>;
  if (typeof row.artifactDigest !== "string" || !Array.isArray(row.objectiveStatements) || !Array.isArray(row.acceptanceStatements)) return null;
  return { ok: true, artifactDigest: row.artifactDigest, objectives: row.objectiveStatements, acceptance: row.acceptanceStatements };
}

export function validateInitiativeSupersessionDispositions(
  requiredStatementIds: readonly string[],
  dispositions: readonly { statementId: string; reason: string }[],
): Array<{ statementId: string; reason: string }> | null {
  const normalized = dispositions.map((entry) => ({ statementId: entry.statementId, reason: entry.reason.trim() }));
  const byId = new Map(normalized.map((entry) => [entry.statementId, entry.reason]));
  if (byId.size !== normalized.length
    || normalized.some(({ statementId, reason }) => !requiredStatementIds.includes(statementId) || reason.length < 20)
    || requiredStatementIds.some((id) => !byId.has(id))) return null;
  return normalized;
}

export type RecordInitiativeSpecApprovalResult =
  | { ok: true; receiptId: string; baselineId: string; artifactDigest: string }
  | { ok: false; code: string; error: string };

class InitiativeApprovalRollback extends Error {
  constructor(readonly result: Extract<RecordInitiativeSpecApprovalResult, { ok: false }>) {
    super(result.error);
  }
}

export async function recordInitiativeSpecApproval(args: {
  itemId: string;
  profile: ReadinessProfile;
  artifactRole: InitiativeScopeBaseline["artifactRole"];
  artifactRef: InitiativeArtifactRef;
  expectedCurrentBaselineId: string | null;
  supersessionDispositions: Array<{ statementId: string; reason: string }>;
  resolvedFindingRefs: string[];
  reason: string;
  reviewerUserId: string;
  reviewerAgentId: string | null;
  authorityDecisionId: string | null;
  tokenScope: string | null;
}): Promise<RecordInitiativeSpecApprovalResult> {
  const dispositionError = validateInitiativeDisposition("pass", [], args.resolvedFindingRefs);
  if (dispositionError) return { ok: false, code: "malformed-receipt", error: dispositionError };
  if (!args.reviewerAgentId || !args.authorityDecisionId || !args.tokenScope) {
    return { ok: false, code: "AUTHORIZATION_DENIED", error: "Authenticated reviewer, authority decision, and token scope are required." };
  }
  const tokenScope = args.tokenScope;
  const item = await prisma.backlogItem.findUnique({
    where: { itemId: args.itemId },
    select: {
      id: true,
      itemId: true,
      title: true,
      organizationId: true,
      type: true,
      source: true,
      workType: true,
      scopeKind: true,
      archetypeCategories: true,
      archetypeIds: true,
      activeBuild: { select: { kind: true } },
    },
  });
  if (!item) return { ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: `BacklogItem ${args.itemId} was not found.` };
  const authority = await prisma.authorizationDecisionLog.findUnique({
    where: { decisionId: args.authorityDecisionId },
    select: { decisionId: true, decision: true, actionKey: true, policyVersion: true, organizationId: true },
  });
  if (!authority || authority.decision !== "allow" || authority.actionKey !== "record_initiative_design_review") {
    return { ok: false, code: "AUTHORIZATION_DENIED", error: "The current tool call has no matching design-review allow decision." };
  }
  const organizationId = item.organizationId ?? "platform";
  // AuthorizationDecisionLog.organizationId is a tenant Organization FK. An
  // organizationless platform initiative therefore persists null while the
  // receipt/baseline snapshot below projects the canonical `platform` scope.
  // A real tenant id on either side must still match exactly.
  if (item.organizationId
    ? authority.organizationId !== item.organizationId
    : authority.organizationId !== null) {
    return { ok: false, code: "AUTHORIZATION_DENIED", error: "Reviewer authority does not match the initiative organization." };
  }
  // BI-72F368BC: attribute the review to the ACTOR — the coworker's own
  // principal when the call carries one — not unconditionally to the
  // delegating human. See reviewer-identity.ts.
  const reviewer = await resolveReviewerIdentity(prisma, {
    reviewerUserId: args.reviewerUserId,
    reviewerAgentId: args.reviewerAgentId,
  });
  if (!reviewer) {
    return {
      ok: false,
      code: "ARTIFACT_AUTHOR_REQUIRED",
      error: `Reviewer principal identity is unavailable: neither agent alias ${args.reviewerAgentId ?? "(none)"} nor user alias ${args.reviewerUserId} resolves to exactly one Principal. Link the reviewer identity to a Principal before recording a governed receipt.`,
    };
  }
  const reviewerPrincipalId = reviewer.principalId;
  const subject: InitiativeSubject = { kind: "backlog-item", id: item.itemId };
  if (args.artifactRef.kind === "repo-blob-at-commit"
    && !/^docs\/superpowers\/specs\/[^/]+\.md$/.test(args.artifactRef.path)) {
    return { ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: "Repository scope approval requires a canonical design under docs/superpowers/specs/." };
  }
  const artifact = await resolveInitiativeArtifact({ locator: args.artifactRef, subject, organizationId });
  if (!artifact.ok) return artifact;
  const content = decodeUtf8(artifact.artifact.bytes);
  if (!content) return { ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: "Canonical design content must be valid UTF-8." };
  const manifest = parseInitiativeScopeManifest(content, artifact.artifact.digest);
  if (!manifest.ok) return { ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: manifest.error };

  let archived: Awaited<ReturnType<typeof writeDocumentBlob>> | null = null;
  if (args.artifactRef.kind === "repo-blob-at-commit") {
    try {
      archived = await writeDocumentBlob({ content: artifact.artifact.bytes });
    } catch {
      return { ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: "Repository design bytes could not be placed in permanent managed storage." };
    }
  }
  if (archived && `sha256:${archived.sha256}` !== artifact.artifact.digest) {
    return { ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS", error: "Repository archive digest does not match the provider-resolved artifact." };
  }

  try {
    return await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "BacklogItem" WHERE "id" = ${item.id} FOR UPDATE`;
    if (args.artifactRef.kind === "feature-build-revision") {
      await tx.$queryRaw`SELECT "id" FROM "BuildArtifactRevision" WHERE "id" = ${args.artifactRef.revisionId} FOR SHARE`;
      await tx.$queryRaw`SELECT b."id" FROM "FeatureBuild" b JOIN "BuildArtifactRevision" r ON r."buildId" = b."buildId" WHERE r."id" = ${args.artifactRef.revisionId} FOR UPDATE OF b`;
    } else if (args.artifactRef.kind === "document-version") {
      await tx.$queryRaw`SELECT d."id" FROM "Document" d JOIN "DocumentVersion" v ON v."documentId" = d."id" WHERE v."id" = ${args.artifactRef.versionId} FOR SHARE OF d, v`;
      await tx.$queryRaw`SELECT b."id" FROM "DocumentBlob" b JOIN "DocumentVersion" v ON v."contentBlobId" = b."id" WHERE v."id" = ${args.artifactRef.versionId} FOR SHARE OF b`;
    } else {
      await tx.$queryRaw`SELECT "id" FROM "WorkCapsule" WHERE "backlogItemId" = ${item.itemId} AND "repositoryFullName" = ${args.artifactRef.repositoryFullName} AND "headSha" = ${args.artifactRef.commitSha} FOR SHARE`;
    }
    const lockedItem = await tx.backlogItem.findUnique({
      where: { id: item.id },
      select: {
        type: true,
        source: true,
        workType: true,
        scopeKind: true,
        archetypeCategories: true,
        archetypeIds: true,
        activeBuild: { select: { kind: true } },
        featureBuilds: { select: { kind: true } },
      },
    });
    if (!lockedItem) return { ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: "The governed initiative no longer exists." };
    const lockedArtifact = await resolveInitiativeArtifact({
      locator: args.artifactRef,
      subject,
      organizationId,
      db: tx as never,
    });
    if (!lockedArtifact.ok) return lockedArtifact;
    if (lockedArtifact.artifact.digest !== artifact.artifact.digest
      || lockedArtifact.artifact.authorPrincipalId !== artifact.artifact.authorPrincipalId
      || lockedArtifact.artifact.authorAgentId !== artifact.artifact.authorAgentId
      || lockedArtifact.artifact.documentBlobId !== artifact.artifact.documentBlobId) {
      return { ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS", error: "Canonical artifact identity changed before approval could be pinned." };
    }
    const priorRows = await tx.backlogItemActivity.findMany({
      where: { backlogItemId: item.id, kind: "initiative_scope_baseline" },
      orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
      select: { payload: true },
    });
    const entries = baselineEntries(priorRows);
    if (!entries) return { ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS", error: "The baseline chain contains a malformed record." };
    const chain = validateInitiativeBaselineChainHead(entries, args.expectedCurrentBaselineId);
    if (!chain.ok) return chain;

    const classificationRows = await tx.backlogItemActivity.findMany({
      where: { backlogItemId: item.id, kind: "initiative_gate_receipt", gateKey: "classification" },
      orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
      select: { payload: true },
    });
    const recordedProfiles = [...priorRows, ...classificationRows].flatMap(({ payload }) => {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
      const row = payload as Record<string, unknown>;
      const profile = row.profile ?? row.selectedProfile;
      return (["doc-only", "fix", "feature", "cross-domain", "archetype"] as const).includes(profile as never)
        ? [profile as ReadinessProfile]
        : [];
    });
    const authoritativeProfile = deriveAuthoritativeReadinessProfile({
      ...lockedItem,
      activeBuildKind: lockedItem.activeBuild?.kind,
      recordedProfiles: [
        ...recordedProfiles,
        ...lockedItem.featureBuilds.flatMap((build) => build.kind === "fix" ? ["fix" as const] : build.kind === "feature" ? ["feature" as const] : []),
      ],
    });
    if (!authoritativeProfile || authoritativeProfile !== args.profile) {
      return { ok: false, code: "CLASSIFICATION_REQUIRED", error: "Requested profile does not match the strongest authoritative classification signal." };
    }

    if (args.expectedCurrentBaselineId) {
      const current = priorRows.find((row) => (row.payload as Record<string, unknown>)?.baselineId === args.expectedCurrentBaselineId);
      const previousManifest = manifestFromBaseline(current?.payload);
      if (!previousManifest) return { ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS", error: "The current baseline manifest is unavailable." };
      const semanticDiff = diffInitiativeScopeManifests(previousManifest, manifest);
      const required = [...semanticDiff.removedOrChangedObjectiveIds, ...semanticDiff.removedOrChangedAcceptanceIds];
      if (!validateInitiativeSupersessionDispositions(required, args.supersessionDispositions)) {
        return { ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS", error: "Scope-reducing supersession requires an explicit disposition for every removed or changed statement." };
      }
    } else if (args.supersessionDispositions.length > 0) {
      return { ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS", error: "An initial baseline cannot carry supersession dispositions." };
    }

    const history = await tx.backlogItemActivity.findMany({
      where: { backlogItemId: item.id, kind: "initiative_gate_receipt", gateKey: "spec_approval" },
      orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
      select: { payload: true },
    });
    const openFindings = new Set<string>();
    for (const row of history) {
      const payload = row.payload as Record<string, unknown>;
      if (payload?.artifactDigest !== artifact.artifact.digest) continue;
      if (Array.isArray(payload.findingRefs)) for (const id of payload.findingRefs) if (typeof id === "string") openFindings.add(id);
      if (Array.isArray(payload.resolvedFindingRefs)) for (const id of payload.resolvedFindingRefs) if (typeof id === "string") openFindings.delete(id);
    }

    const receiptId = `initiative-${randomUUID()}`;
    const baselineId = `baseline-${randomUUID()}`;
    const baselineActivityId = `initiative-${randomUUID()}`;
    const authoritySnapshot: InitiativeAuthoritySnapshot = {
      decision: "allow",
      effectiveHumanCapability: "manage_backlog",
      effectiveAgentGrant: "initiative_design_review",
      tokenScope,
      organizationId,
      actionKey: authority.actionKey,
      policyVersion: authority.policyVersion ?? "coworker-authority.v1",
    };
    const validated = validateInitiativeGateReceiptDraft({
      gate: "spec-approval",
      decision: "pass",
      artifactRef: args.artifactRef,
      reason: args.reason,
      findingRefs: [],
      resolvedFindingRefs: args.resolvedFindingRefs,
    }, {
      receiptId,
      policyVersion: "initiative-readiness.v1",
      allowedGates: ["spec-approval"],
      subject,
      resolvedArtifact: artifact.artifact,
      reviewerPrincipalId,
      reviewerAgentId: args.reviewerAgentId,
      authorityDecisionId: authority.decisionId,
      authoritySnapshot,
      openFindingRefs: [...openFindings],
      resolvedFindings: [],
      requiresIndependentReviewer: true,
    });
    if (!validated.ok) return { ok: false, code: validated.code, error: validated.error };

    let retainedArtifact: RetainedInitiativeArtifact;
    if (args.artifactRef.kind === "feature-build-revision") {
      retainedArtifact = { sourceKind: "build-artifact-revision", buildArtifactRevisionId: args.artifactRef.revisionId };
    } else if (args.artifactRef.kind === "document-version") {
      retainedArtifact = {
        sourceKind: "document-version",
        documentVersionId: args.artifactRef.versionId,
        documentBlobId: artifact.artifact.documentBlobId ?? null,
      };
    } else {
      if (!archived) return { ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: "Repository archive was not prepared." };
      const blob = await tx.documentBlob.upsert({
        where: { sha256: archived.sha256 },
        update: {},
        create: { sha256: archived.sha256, storageKey: archived.storageKey, mimeType: "text/markdown; charset=utf-8", sizeBytes: archived.sizeBytes },
        select: { id: true, storageKey: true, sizeBytes: true },
      });
      if (blob.storageKey !== archived.storageKey || blob.sizeBytes !== archived.sizeBytes) {
        throw new InitiativeApprovalRollback({ ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS", error: "Existing content-addressed blob metadata does not match the provider archive." });
      }
      // Managed Documents are install-owned storage records. The canonical
      // document store resolves a missing business organization to the
      // install's first Organization row; this storage FK does not replace the
      // `platform` subject/authority scope carried by the receipt and baseline.
      const documentOrganizationId = item.organizationId ?? (await tx.organization.findFirst({
        orderBy: { createdAt: "asc" },
        select: { id: true },
      }))?.id ?? null;
      if (!documentOrganizationId) {
        throw new InitiativeApprovalRollback({ ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: "No Organization row exists for retained design storage." });
      }
      const document = await tx.document.create({
        data: {
          documentId: `DOC-INIT-${randomUUID().toUpperCase()}`,
          organizationId: documentOrganizationId,
          title: `${item.title} — retained canonical design`,
          documentKind: "initiative-design",
          contentFormat: "markdown",
          sourceKind: "governance-archive",
          externalLocator: { kind: "initiative-subject", subject, providerArtifact: args.artifactRef } as Prisma.InputJsonValue,
          currentState: "archived",
          archivedAt: new Date(),
          accessScope: "organization",
          ownerPrincipalId: artifact.artifact.authorPrincipalId,
          createdByPrincipalId: artifact.artifact.authorPrincipalId,
        },
        select: { id: true },
      });
      const version = await tx.documentVersion.create({
        data: {
          documentId: document.id,
          version: 1,
          title: `${item.title} — retained canonical design`,
          contentFormat: "markdown",
          contentBlobId: blob.id,
          contentSha256: archived.sha256,
          sizeBytes: archived.sizeBytes,
          createdByPrincipalId: artifact.artifact.authorPrincipalId,
        },
        select: { id: true },
      });
      await tx.document.update({ where: { id: document.id }, data: { currentVersionId: version.id }, select: { id: true } });
      retainedArtifact = { sourceKind: "repository-blob-archive", documentVersionId: version.id, documentBlobId: blob.id };
    }

    const built = buildInitiativeBaselineAndPin({
      baselineId,
      baselineActivityId,
      subject,
      profile: args.profile,
      artifactRole: args.artifactRole,
      artifactRef: args.artifactRef,
      artifactDigest: artifact.artifact.digest,
      manifest,
      supersedesBaselineId: args.expectedCurrentBaselineId,
      supersessionDispositions: args.supersessionDispositions.map((entry) => ({ statementId: entry.statementId, reason: entry.reason.trim() })),
      approvalReceipt: {
        receiptId,
        gate: "spec-approval",
        decision: "pass",
        subject,
        artifactRef: args.artifactRef,
        artifactDigest: artifact.artifact.digest,
        authoritySnapshot,
      },
      retainedArtifact,
    });
    if (!built.ok) throw new InitiativeApprovalRollback(built);

    await tx.backlogItemActivity.create({ data: {
      id: receiptId,
      backlogItemId: item.id,
      kind: "initiative_gate_receipt",
      gateKey: "spec_approval",
      summary: "spec-approval: pass",
      payload: validated.receipt as unknown as Prisma.InputJsonValue,
      recordedById: args.reviewerUserId,
      recordedByAgentId: args.reviewerAgentId,
    } });
    await tx.backlogItemActivity.create({ data: {
      id: baselineActivityId,
      backlogItemId: item.id,
      kind: "initiative_scope_baseline",
      summary: `Canonical initiative scope baseline ${baselineId}`,
      payload: built.baseline as unknown as Prisma.InputJsonValue,
      recordedById: args.reviewerUserId,
      recordedByAgentId: args.reviewerAgentId,
    } });
    await tx.initiativeArtifactRetentionPin.create({ data: {
      baselineActivityId,
      sourceKind: built.pin.sourceKind.replaceAll("-", "_") as never,
      artifactDigest: built.pin.artifactDigest,
      artifactLocator: built.pin.artifactLocator as unknown as Prisma.InputJsonValue,
      buildArtifactRevisionId: "buildArtifactRevisionId" in built.pin ? built.pin.buildArtifactRevisionId : null,
      documentVersionId: "documentVersionId" in built.pin ? built.pin.documentVersionId : null,
      documentBlobId: "documentBlobId" in built.pin ? built.pin.documentBlobId : null,
    } });
    return { ok: true, receiptId, baselineId, artifactDigest: artifact.artifact.digest };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof InitiativeApprovalRollback) return error.result;
    throw error;
  }
}
