import { createHash } from "node:crypto";

import { prisma } from "@dpf/db";

import {
  resolveGithubToken,
  resolveRepoIdentity,
} from "@/lib/contributor-change-lanes/github-rest-reader";
import type { InitiativeArtifactRef } from "./receipt-schema";
import type { InitiativeSubject } from "./types";

type RepositoryLocator = Extract<InitiativeArtifactRef, { kind: "repo-blob-at-commit" }>;

type RepositoryArtifactDb = {
  workCapsule: {
    findMany: (args: Record<string, unknown>) => Promise<Array<{
      createdByPrincipalId: string | null;
      activities: Array<{ recordedByAgentId: string | null }>;
    }>>;
  };
  principalAlias: {
    findFirst: (args: Record<string, unknown>) => Promise<{ principalId: string } | null>;
  };
  credentialEntry: typeof prisma.credentialEntry;
  platformDevConfig: typeof prisma.platformDevConfig;
  scheduledJob: typeof prisma.scheduledJob;
};

export type ResolvedRepositoryArtifact = {
  digest: string;
  bytes: Uint8Array;
  authorPrincipalId: string;
  authorAgentId: string;
};

export type ResolveRepositoryArtifactResult =
  | { ok: true; artifact: ResolvedRepositoryArtifact }
  | { ok: false; code: "ARTIFACT_AUTHOR_REQUIRED" | "CANONICAL_DESIGN_REQUIRED" | "CANONICAL_DESIGN_AMBIGUOUS"; error: string };

function encodePath(path: string): string | null {
  const pieces = path.split("/");
  if (pieces.some((piece) => !piece || piece === "." || piece === "..")) return null;
  return pieces.map(encodeURIComponent).join("/");
}

function decodeGithubContent(payload: unknown, expectedBlobId: string): Uint8Array | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  if (row.type !== "file" || row.sha !== expectedBlobId || row.encoding !== "base64" || typeof row.content !== "string") {
    return null;
  }
  return Buffer.from(row.content.replace(/\s/g, ""), "base64");
}

export async function resolveRepositoryArtifact(args: {
  locator: RepositoryLocator;
  subject: InitiativeSubject;
  db?: RepositoryArtifactDb;
  fetchImpl?: typeof fetch;
}): Promise<ResolveRepositoryArtifactResult> {
  const db = args.db ?? (prisma as unknown as RepositoryArtifactDb);
  const expectedRepo = await resolveRepoIdentity(db);
  const expectedFullName = `${expectedRepo.owner}/${expectedRepo.name}`;
  const encodedPath = encodePath(args.locator.path);
  if (args.locator.repositoryFullName.toLocaleLowerCase("en-US") !== expectedFullName.toLocaleLowerCase("en-US")
    || !/^[a-f0-9]{40}$/i.test(args.locator.commitSha)
    || !/^[a-f0-9]{40}$/i.test(args.locator.providerBlobId)
    || !encodedPath) {
    return { ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: "Repository artifact locator is not a recognized immutable provider blob." };
  }

  const subjectWhere = args.subject.kind === "backlog-item"
    ? { backlogItemId: args.subject.id }
    : args.subject.kind === "epic"
      ? { epicId: args.subject.id }
      : args.subject.kind === "feature-build"
        ? { featureBuildId: args.subject.id }
        : null;
  if (!subjectWhere) {
    return { ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS", error: "Repository artifacts require a capsule-backed initiative subject." };
  }
  const capsules = await db.workCapsule.findMany({
    where: {
      ...subjectWhere,
      repositoryFullName: args.locator.repositoryFullName,
      headSha: args.locator.commitSha,
      archivedAt: null,
      status: { notIn: ["abandoned", "cancelled"] },
    },
    take: 2,
    select: {
      createdByPrincipalId: true,
      activities: {
        where: { recordedByAgentId: { not: null } },
        orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
        take: 1,
        select: { recordedByAgentId: true },
      },
    },
  });
  if (capsules.length !== 1) {
    return { ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS", error: "Repository artifact ownership is missing or ambiguous for this subject." };
  }
  const principalId = capsules[0]?.createdByPrincipalId;
  const agentId = capsules[0]?.activities[0]?.recordedByAgentId;
  const agentAlias = principalId && agentId
    ? await db.principalAlias.findFirst({ where: { principalId, aliasType: "agent", aliasValue: agentId, issuer: "" }, select: { principalId: true } })
    : null;
  if (!principalId || !agentId || !agentAlias) {
    return { ok: false, code: "ARTIFACT_AUTHOR_REQUIRED", error: "Repository artifact author cannot be mapped to one capsule principal and agent." };
  }

  const token = await resolveGithubToken(db);
  const response = await (args.fetchImpl ?? fetch)(
    `https://api.github.com/repos/${encodeURIComponent(expectedRepo.owner)}/${encodeURIComponent(expectedRepo.name)}/contents/${encodedPath}?ref=${encodeURIComponent(args.locator.commitSha)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      cache: "no-store",
    },
  );
  if (!response.ok) {
    return { ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: "Repository provider could not resolve the immutable artifact." };
  }
  const bytes = decodeGithubContent(await response.json(), args.locator.providerBlobId);
  if (!bytes) {
    return { ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS", error: "Repository provider blob identity does not match the requested locator." };
  }
  return {
    ok: true,
    artifact: {
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      bytes,
      authorPrincipalId: principalId,
      authorAgentId: agentId,
    },
  };
}
