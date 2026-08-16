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
  workroom: {
    findMany: (args: Record<string, unknown>) => Promise<Array<{
      createdByPrincipalId: string | null;
      activities: Array<{ recordedByAgentId: string | null }>;
    }>>;
  };
  principalAlias: {
    findMany: (args: Record<string, unknown>) => Promise<Array<{ principalId?: string; aliasValue?: string }>>;
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

function dcoEmail(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const commit = (payload as Record<string, unknown>).commit;
  if (!commit || typeof commit !== "object" || Array.isArray(commit)) return null;
  const message = (commit as Record<string, unknown>).message;
  if (typeof message !== "string") return null;
  const matches = [...message.matchAll(/^Signed-off-by:\s+.+?\s+<([^<>\s@]+@[^<>\s@]+)>\s*$/gim)];
  const emails = [...new Set(matches.map((match) => match[1]!.toLocaleLowerCase("en-US")))];
  return emails.length === 1 ? emails[0]! : null;
}

export async function resolveRepositoryArtifact(args: {
  locator: RepositoryLocator;
  subject: InitiativeSubject;
  db?: RepositoryArtifactDb;
  fetchImpl?: typeof fetch;
}): Promise<ResolveRepositoryArtifactResult> {
  const db = args.db ?? (prisma as unknown as RepositoryArtifactDb);
  let expectedRepo: Awaited<ReturnType<typeof resolveRepoIdentity>>;
  try {
    expectedRepo = await resolveRepoIdentity(db);
  } catch {
    return { ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: "Canonical repository identity is unavailable." };
  }
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
  const capsules = await db.workroom.findMany({
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
        select: { recordedByAgentId: true },
      },
    },
  });
  if (capsules.length !== 1) {
    return { ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS", error: "Repository artifact ownership is missing or ambiguous for this subject." };
  }
  let token: string | null;
  try {
    token = await resolveGithubToken(db);
  } catch {
    return { ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: "Repository provider credentials are unavailable." };
  }
  let commitResponse: Response;
  try {
    commitResponse = await (args.fetchImpl ?? fetch)(
      `https://api.github.com/repos/${encodeURIComponent(expectedRepo.owner)}/${encodeURIComponent(expectedRepo.name)}/commits/${encodeURIComponent(args.locator.commitSha)}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        cache: "no-store",
      },
    );
  } catch {
    return { ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: "Repository provider could not resolve immutable commit provenance." };
  }
  if (!commitResponse.ok) {
    return { ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: "Repository provider could not resolve immutable commit provenance." };
  }
  let commitPayload: unknown;
  try {
    commitPayload = await commitResponse.json();
  } catch {
    return { ok: false, code: "ARTIFACT_AUTHOR_REQUIRED", error: "Repository commit provenance is unreadable." };
  }
  const email = dcoEmail(commitPayload);
  if (!email) {
    return { ok: false, code: "ARTIFACT_AUTHOR_REQUIRED", error: "Repository commit has no single DCO sign-off identity." };
  }
  const principals = await db.principalAlias.findMany({
    where: { aliasType: "email", aliasValue: email, issuer: "" },
    select: { principalId: true },
    take: 2,
  });
  const principalId = principals.length === 1 ? principals[0]?.principalId : null;
  const capsule = capsules[0];
  const participatingAgentIds = new Set(
    capsule?.activities.map((activity) => activity.recordedByAgentId).filter((id): id is string => Boolean(id)) ?? [],
  );
  const agentId = participatingAgentIds.size === 1 ? [...participatingAgentIds][0]! : null;
  const agentAliases = principalId && agentId
    ? await db.principalAlias.findMany({
      where: { principalId, aliasType: "agent", aliasValue: agentId, issuer: "" },
      select: { aliasValue: true },
      take: 2,
    })
    : [];
  if (!principalId || !agentId
    || capsule?.createdByPrincipalId !== principalId
    || agentAliases.length !== 1) {
    return { ok: false, code: "ARTIFACT_AUTHOR_REQUIRED", error: "Repository DCO author cannot be mapped unambiguously through capsule provenance." };
  }

  let response: Response;
  try {
    response = await (args.fetchImpl ?? fetch)(
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
  } catch {
    return { ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: "Repository provider could not resolve the immutable artifact." };
  }
  if (!response.ok) {
    return { ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: "Repository provider could not resolve the immutable artifact." };
  }
  let providerPayload: unknown;
  try {
    providerPayload = await response.json();
  } catch {
    return { ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: "Repository provider returned unreadable artifact metadata." };
  }
  const bytes = decodeGithubContent(providerPayload, args.locator.providerBlobId);
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
