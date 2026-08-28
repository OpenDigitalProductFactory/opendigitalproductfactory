import { createHash } from "node:crypto";

import { prisma } from "@dpf/db";

import { renderBuildDesignText } from "./render-build-design-text";

import { readDocumentBlob } from "@/lib/documents/blob-storage";
import { resolveRepositoryArtifact } from "./repository-artifact";
import type { InitiativeArtifactRef, ResolvedInitiativeArtifact } from "./receipt-schema";
import type { InitiativeSubject } from "./types";

type BuildRevisionRecord = {
  id: string;
  valueDigest: string;
  value?: unknown;
  field?: string;
  status?: string;
  savedByUserId: string;
  savedByAgentId: string | null;
  build: {
    buildId?: string;
    originatingBacklogItemId: string | null;
    originator?: { itemId: string } | null;
    parentEpicId?: string | null;
    abandonedAt: Date | null;
    artifactRevisions?: Array<{ id: string }>;
  };
};

type DocumentVersionRecord = {
  id: string;
  contentSha256: string | null;
  contentBlobId: string | null;
  contentText?: string | null;
  createdByPrincipal: { principalId: string } | null;
  document?: {
    currentVersionId: string | null;
    organizationId: string;
    documentKind: string;
    externalLocator: unknown;
  };
  contentBlob?: { storageKey: string; sha256: string } | null;
};

export type InitiativeArtifactResolverDb = {
  buildArtifactRevision: {
    findUnique: (args: Record<string, unknown>) => Promise<BuildRevisionRecord | null>;
  };
  documentVersion: {
    findUnique: (args: Record<string, unknown>) => Promise<DocumentVersionRecord | null>;
  };
  principalAlias: {
    findMany: (args: Record<string, unknown>) => Promise<Array<{
      principal?: { principalId: string };
      principalId?: string;
      aliasValue?: string;
    }>>;
  };
};

export type ProviderResolvedBlob = {
  digest: string;
  authorPrincipalId: string | null;
  authorAgentId: string | null;
  bytes: Uint8Array;
};

export type InitiativeArtifactResolution =
  | { ok: true; artifact: ResolvedInitiativeArtifact & { documentBlobId?: string | null; bytes: Uint8Array } }
  | {
    ok: false;
    code: "ARTIFACT_AUTHOR_REQUIRED" | "CANONICAL_DESIGN_REQUIRED" | "CANONICAL_DESIGN_AMBIGUOUS";
    error: string;
  };

function subjectOwnsBuild(subject: InitiativeSubject, build: BuildRevisionRecord["build"]): boolean {
  if (build.abandonedAt) return false;
  if (subject.kind === "backlog-item") {
    return build.originator?.itemId === subject.id || build.originatingBacklogItemId === subject.id;
  }
  if (subject.kind === "feature-build") return build.buildId === subject.id;
  if (subject.kind === "epic") return build.parentEpicId === subject.id;
  return false;
}

function initiativeTextFromBuildValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const markdown = (value as Record<string, unknown>).initiativeScopeMarkdown;
  if (typeof markdown === "string" && markdown.trim()) return markdown;
  // BI-126441FA: a Build Studio design document IS the initiative's design, but
  // it is stored structured and nothing writes initiativeScopeMarkdown — so
  // every one of them resolved to null and was refused as "not an accepted
  // canonical initiative design", blocking spec-approval, the canonical
  // baseline and artifact author. Render it here rather than at save time so
  // existing revisions resolve without rewriting stored artifacts and the
  // pinned valueDigest keeps covering exactly what the author saved.
  return renderBuildDesignText(value);
}

function externalLocatorMatchesSubject(locator: unknown, subject: InitiativeSubject): boolean {
  if (!locator || typeof locator !== "object" || Array.isArray(locator)) return false;
  const value = locator as Record<string, unknown>;
  const linked = value.subject;
  return value.kind === "initiative-subject"
    && Boolean(linked && typeof linked === "object" && !Array.isArray(linked)
      && (linked as Record<string, unknown>).kind === subject.kind
      && (linked as Record<string, unknown>).id === subject.id);
}

function authorRequired(error: string): InitiativeArtifactResolution {
  return { ok: false, code: "ARTIFACT_AUTHOR_REQUIRED", error };
}

export async function resolveInitiativeArtifact(args: {
  locator: InitiativeArtifactRef;
  subject: InitiativeSubject;
  db?: InitiativeArtifactResolverDb;
  resolveDocumentAuthorAgent?: (versionId: string, principalId: string) => Promise<string | null>;
  documentBelongsToSubject?: (versionId: string, subject: InitiativeSubject) => Promise<boolean>;
  organizationId?: string | null;
  resolveRepositoryBlob?: (locator: Extract<InitiativeArtifactRef, { kind: "repo-blob-at-commit" }>) => Promise<ProviderResolvedBlob | null>;
}): Promise<InitiativeArtifactResolution> {
  const db = args.db ?? (prisma as unknown as InitiativeArtifactResolverDb);
  if (args.locator.kind === "feature-build-revision") {
    const revision = await db.buildArtifactRevision.findUnique({
      where: { id: args.locator.revisionId },
      select: {
        id: true,
        valueDigest: true,
        value: true,
        field: true,
        status: true,
        savedByUserId: true,
        savedByAgentId: true,
        build: {
          select: {
            buildId: true,
            originatingBacklogItemId: true,
            originator: { select: { itemId: true } },
            parentEpicId: true,
            abandonedAt: true,
            artifactRevisions: {
              where: { field: "designDoc", status: "accepted" },
              orderBy: [{ revisionNumber: "desc" }, { createdAt: "desc" }],
              take: 1,
              select: { id: true },
            },
          },
        },
      },
    });
    const content = revision ? initiativeTextFromBuildValue(revision.value) : null;
    if (!revision || revision.field !== "designDoc" || revision.status !== "accepted" || !content) {
      return { ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: "Build artifact revision is not an accepted canonical initiative design." };
    }
    const aliases = await db.principalAlias.findMany({
      where: { aliasType: "user", aliasValue: revision.savedByUserId, issuer: "" },
      select: { principal: { select: { principalId: true } } },
      take: 2,
    });
    const authorPrincipalId = aliases.length === 1 ? aliases[0]?.principal?.principalId : null;
    if (!authorPrincipalId || !revision.savedByAgentId) {
      return authorRequired("Build artifact author provenance is incomplete or ambiguous.");
    }
    if (!subjectOwnsBuild(args.subject, revision.build)) {
      return { ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS", error: "Build artifact does not belong to the governed subject." };
    }
    if (revision.build.artifactRevisions?.[0]?.id !== revision.id) {
      return { ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS", error: "Build artifact revision is not the current accepted design revision." };
    }
    return {
      ok: true,
      artifact: {
        ref: args.locator,
        digest: revision.valueDigest.startsWith("sha256:") ? revision.valueDigest : `sha256:${revision.valueDigest}`,
        authorPrincipalId,
        authorAgentId: revision.savedByAgentId,
        bytes: Buffer.from(content, "utf8"),
      },
    };
  }

  if (args.locator.kind === "document-version") {
    const version = await db.documentVersion.findUnique({
      where: { id: args.locator.versionId },
      select: {
        id: true,
        contentSha256: true,
        contentBlobId: true,
        contentText: true,
        createdByPrincipal: { select: { principalId: true } },
        document: { select: { currentVersionId: true, organizationId: true, documentKind: true, externalLocator: true } },
        contentBlob: { select: { storageKey: true, sha256: true } },
      },
    });
    if (!version?.contentSha256) {
      return { ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: "Document version has no immutable content digest." };
    }
    const principalId = version.createdByPrincipal?.principalId;
    const aliases = principalId && !args.resolveDocumentAuthorAgent
      ? await db.principalAlias.findMany({
        where: { principalId, aliasType: "agent", issuer: "" },
        select: { aliasValue: true },
        take: 2,
      })
      : [];
    const agentId = principalId
      ? args.resolveDocumentAuthorAgent
        ? await args.resolveDocumentAuthorAgent(version.id, principalId)
        : aliases.length === 1 ? aliases[0]?.aliasValue ?? null : null
      : null;
    if (!principalId || !agentId) return authorRequired("Document author provenance is incomplete or ambiguous.");
    const belongs = args.documentBelongsToSubject
      ? await args.documentBelongsToSubject(version.id, args.subject)
      : version.document?.currentVersionId === version.id
        && (!args.organizationId || version.document.organizationId === args.organizationId)
        && version.document.documentKind === "initiative-design"
        && externalLocatorMatchesSubject(version.document.externalLocator, args.subject);
    if (!belongs) {
      return { ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS", error: "Document version is not canonically linked to the governed subject." };
    }
    let bytes: Uint8Array;
    if (version.contentText) {
      bytes = Buffer.from(version.contentText, "utf8");
    } else if (version.contentBlob && version.contentBlobId) {
      try {
        bytes = await readDocumentBlob({
          storageKey: version.contentBlob.storageKey,
          expectedSha256: version.contentBlob.sha256,
        });
      } catch (error) {
        const missing = typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
        return missing
          ? { ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: "Document version bytes are unavailable." }
          : { ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS", error: "Document version bytes could not be verified against immutable storage metadata." };
      }
    } else {
      return { ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: "Document version bytes are unavailable." };
    }
    const computedDigest = createHash("sha256").update(bytes).digest("hex");
    const storedDigest = version.contentSha256.replace(/^sha256:/, "");
    if (computedDigest !== storedDigest) {
      return { ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS", error: "Document bytes do not match the stored immutable digest." };
    }
    return {
      ok: true,
      artifact: {
        ref: args.locator,
        digest: `sha256:${computedDigest}`,
        authorPrincipalId: principalId,
        authorAgentId: agentId,
        documentBlobId: version.contentBlobId,
        bytes,
      },
    };
  }

  let providerBlob: ProviderResolvedBlob | null;
  try {
    if (args.resolveRepositoryBlob) {
      providerBlob = await args.resolveRepositoryBlob(args.locator);
    } else {
      const resolved = await resolveRepositoryArtifact({ locator: args.locator, subject: args.subject, db: db as never });
      if (!resolved.ok) return resolved;
      providerBlob = resolved.artifact;
    }
  } catch {
    return { ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: "Repository provider could not resolve the immutable artifact." };
  }
  // BI-B9403248: the accountable author is a PRINCIPAL. Agent identity is
  // optional context — an external Claude/Codex/Grok session records its work
  // under a human principal and has no agent id at all, and demanding one asked
  // which surface produced the artifact rather than reading its evidence.
  if (!providerBlob?.authorPrincipalId) {
    return authorRequired("Repository blob author could not be mapped to an accountable principal.");
  }
  return {
    ok: true,
    artifact: {
      ref: args.locator,
      digest: providerBlob.digest,
      authorPrincipalId: providerBlob.authorPrincipalId,
      authorAgentId: providerBlob.authorAgentId,
      bytes: providerBlob.bytes,
    },
  };
}
