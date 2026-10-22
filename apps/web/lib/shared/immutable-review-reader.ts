import { SOURCE_READ_MAX_CHARS, SOURCE_READ_MAX_LINES } from "../source-page-lines";

export type ImmutableReaderArguments = {
  repositoryFullName: string;
  path: string;
  version: string;
  expectedBlobId: string;
};

/**
 * The immutable artifact a review binds to. A repository blob is read with
 * `read_source_at_version`; a Build Studio design revision (BI-926A7E90) is read
 * with `read_build_artifact_revision`. Both readers serve the same page shape
 * and the same four identity keys, so the policy below is reader-agnostic: for
 * a revision, `path` is the virtual `build-artifact-revision/<revisionId>`,
 * `version` is the revision id and `expectedBlobId` is its value digest.
 */
export type ImmutableReaderArtifactRef =
  | { kind: "document-version"; repositoryFullName: string; versionId: string; valueDigest: string }
  | {
    kind?: "repo-blob-at-commit";
    repositoryFullName: string;
    path: string;
    commitSha: string;
    providerBlobId: string;
  }
  | {
    kind: "feature-build-revision";
    repositoryFullName: string;
    revisionId: string;
    valueDigest: string;
  };

export const REPOSITORY_BLOB_READER_TOOL = "read_source_at_version";
export const BUILD_ARTIFACT_REVISION_READER_TOOL = "read_build_artifact_revision";
export const BUILD_ARTIFACT_REVISION_PATH_PREFIX = "build-artifact-revision/";
/** Page readers: each serves one bounded page of the bound artifact. */
export const IMMUTABLE_PAGE_READER_TOOLS = [REPOSITORY_BLOB_READER_TOOL, BUILD_ARTIFACT_REVISION_READER_TOOL] as const;

export function isImmutablePageReader(toolName: string): boolean {
  return (IMMUTABLE_PAGE_READER_TOOLS as readonly string[]).includes(toolName);
}

export function immutablePageReaderForArtifact(artifactRef: ImmutableReaderArtifactRef): string {
  if (artifactRef.kind === "document-version") return REPOSITORY_BLOB_READER_TOOL;
  return artifactRef.kind === "feature-build-revision" ? BUILD_ARTIFACT_REVISION_READER_TOOL : REPOSITORY_BLOB_READER_TOOL;
}

export function immutableReaderArgumentsFor(artifactRef: ImmutableReaderArtifactRef): ImmutableReaderArguments {
  if (artifactRef.kind === "document-version") return {
    repositoryFullName: artifactRef.repositoryFullName, path: `initiative-body-version/${artifactRef.versionId}`,
    version: artifactRef.versionId, expectedBlobId: artifactRef.valueDigest,
  };
  if (artifactRef.kind === "feature-build-revision") {
    return {
      repositoryFullName: artifactRef.repositoryFullName,
      path: `${BUILD_ARTIFACT_REVISION_PATH_PREFIX}${artifactRef.revisionId}`,
      version: artifactRef.revisionId,
      expectedBlobId: artifactRef.valueDigest,
    };
  }
  return {
    repositoryFullName: artifactRef.repositoryFullName,
    path: artifactRef.path,
    version: artifactRef.commitSha,
    expectedBlobId: artifactRef.providerBlobId,
  };
}

export type ImmutableReaderNormalizationPolicy = {
  readerToolNames: readonly string[];
  immutableReaderArguments?: ImmutableReaderArguments;
};

export type TerminalToolArgumentDisposition =
  | { kind: "allow"; arguments: Record<string, unknown> }
  | {
      kind: "refuse";
      result: { success: false; error: string; message: string };
    };

const IMMUTABLE_READER_IDENTITY_KEYS = ["repositoryFullName", "path", "version", "expectedBlobId"] as const;

export function boundedImmutableReaderInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum;
}

/**
 * Treat the server-issued initiative-review binding as authority for immutable
 * source identity. Provider arguments may select only a bounded page within
 * that artifact; they cannot replace or broaden the bound artifact itself.
 */
/**
 * BI-E8237EAE: the largest reader page a model sees whole through a tool-result
 * cap of `modelVisibleChars`. The page travels inside a JSON envelope (message,
 * identity, cursor) and JSON escaping grows the content, so the page is the cap
 * less a fixed envelope allowance, less an escaping margin.
 */
export function readerPageCharsForModelView(modelVisibleChars: number): number {
  return Math.min(SOURCE_READ_MAX_CHARS, Math.max(500, Math.floor((modelVisibleChars - 1_200) * 0.8)));
}

// A fixed floor, then one read per page of the bound artifact plus two for a
// restart, never more than this ceiling (BI-E8237EAE).
export function normalizeTerminalToolArguments(
  policy: ImmutableReaderNormalizationPolicy,
  toolName: string,
  providerArguments: Record<string, unknown>,
  modelVisibleChars?: number,
): TerminalToolArgumentDisposition {
  if (!isImmutablePageReader(toolName) || !policy.readerToolNames.includes(toolName)) {
    return { kind: "allow", arguments: providerArguments };
  }

  const binding = policy.immutableReaderArguments;
  if (!binding) {
    return {
      kind: "refuse",
      result: {
        success: false,
        error: "terminal_reader_binding_missing",
        message: "The immutable evidence reader has no server-issued artifact binding.",
      },
    };
  }

  for (const key of IMMUTABLE_READER_IDENTITY_KEYS) {
    if (Object.hasOwn(providerArguments, key) && providerArguments[key] !== binding[key]) {
      return {
        kind: "refuse",
        result: {
          success: false,
          error: "terminal_reader_identity_conflict",
          message: `The provider-supplied ${key} conflicts with the server-issued artifact binding.`,
        },
      };
    }
  }

  const normalized: Record<string, unknown> = { ...binding };
  const cursor = providerArguments["cursor"];
  if (cursor !== undefined) {
    if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > 2_048) {
      return {
        kind: "refuse",
        result: {
          success: false,
          error: "terminal_reader_pagination_invalid",
          message: "The immutable evidence cursor must be a non-empty bounded string.",
        },
      };
    }
    normalized["cursor"] = cursor;
  }

  const boundedControls = [
    ["startLine", 1, Number.MAX_SAFE_INTEGER],
    ["maxLines", 1, SOURCE_READ_MAX_LINES],
    ["maxChars", 1, SOURCE_READ_MAX_CHARS],
  ] as const;
  for (const [name, minimum, maximum] of boundedControls) {
    const value = providerArguments[name];
    if (value === undefined) continue;
    if (!boundedImmutableReaderInteger(value, minimum, maximum)) {
      return {
        kind: "refuse",
        result: {
          success: false,
          error: "terminal_reader_pagination_invalid",
          message: `${name} is outside the immutable evidence pagination bounds.`,
        },
      };
    }
    normalized[name] = value;
  }
  // BI-E8237EAE: a page the model cannot see whole is ruled invalid evidence and
  // forces a restart, so never request one larger than the model's view.
  if (modelVisibleChars !== undefined) {
    const visiblePage = readerPageCharsForModelView(modelVisibleChars);
    const requested = typeof normalized["maxChars"] === "number" ? normalized["maxChars"] as number : Number.POSITIVE_INFINITY;
    normalized["maxChars"] = Math.min(requested, visiblePage);
  }

  return { kind: "allow", arguments: normalized };
}

