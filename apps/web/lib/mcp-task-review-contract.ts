import { SOURCE_READ_MAX_CHARS, SOURCE_READ_MAX_LINES } from "./source-page-lines";
import type { ToolDefinition } from "@/lib/mcp-tool-types";
import {
  IMMUTABLE_PAGE_READER_TOOLS,
  immutablePageReaderForArtifact,
  immutableReaderArgumentsFor,
  isImmutablePageReader,
} from "@/lib/tak/terminal-tool-policy";

export type InitiativeReviewBinding = {
  writerToolName: string;
  itemId: string;
  gate: string;
  expectedCurrentBaselineId?: string | null;
  eligibleEvidenceActivityIds?: string[];
  workroomRef?: {
    kind: "workroom-head";
    workroomId: string;
    repositoryFullName: string;
    branchName: string;
    headSha: string;
  };
  artifactRef: InitiativeReviewArtifactRef;
};

/**
 * The immutable artifact a review binds to. BI-926A7E90: a Build Studio design
 * is a `BuildArtifactRevision`, bound by revision id and value digest and read
 * through `read_build_artifact_revision`; a repository blob is read through
 * `read_source_at_version`. `repositoryFullName` is present on both so the
 * workroom and artifact bindings can still be checked against each other.
 */
/** The repository-blob form of a binding's artifact, or null for any other kind. */
export function repoBlobArtifactRef(
  ref: InitiativeReviewArtifactRef,
): Extract<InitiativeReviewArtifactRef, { kind: "repo-blob-at-commit" }> | null {
  return ref.kind === "repo-blob-at-commit" ? ref : null;
}

/**
 * The four reader identity keys for any artifact kind: `version` is the commit
 * sha or the revision id, `expectedBlobId` the blob id or the value digest.
 */
export function immutableArtifactIdentity(ref: InitiativeReviewArtifactRef) {
  return immutableReaderArgumentsFor(ref);
}

export type InitiativeReviewArtifactRef =
  | {
    kind: "repo-blob-at-commit";
    repositoryFullName: string;
    commitSha: string;
    path: string;
    providerBlobId: string;
  }
  | {
    kind: "feature-build-revision";
    repositoryFullName: string;
    revisionId: string;
    valueDigest: string;
  };

const MAX_ELIGIBLE_EVIDENCE_ACTIVITY_IDS = 500;

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function boundedUniqueStrings(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ELIGIBLE_EVIDENCE_ACTIVITY_IDS) return null;
  const values = value.map(optionalString);
  if (values.some((entry) => !entry)) return null;
  const normalized = values as string[];
  return new Set(normalized).size === normalized.length ? [...normalized].sort() : null;
}

function scopedToolNames(authorityScope: readonly string[] | undefined): string[] {
  return [...new Set((authorityScope ?? []).flatMap((entry) => {
    const name = entry.startsWith("tool:") ? entry.slice("tool:".length).trim() : "";
    return name ? [name] : [];
  }))];
}

export function requiredToolNames(authorityScope: readonly string[] | undefined): string[] {
  return scopedToolNames(authorityScope).slice(0, 4);
}

export function requiresInitiativeReviewEffort(toolNames: readonly string[]): boolean {
  const immutableReadRequired = toolNames.some((name) =>
    isImmutablePageReader(name) || name === "search_source_at_version"
  );
  const researchWriterRequired = toolNames.includes("record_initiative_evidence")
    && immutableReadRequired;
  const independentReviewWriterRequired = toolNames.some((name) =>
    name.startsWith("record_initiative_") && name.endsWith("_review")
  );
  return researchWriterRequired || independentReviewWriterRequired;
}

function explicitlyRequestsObjectiveMapping(prompt: string | undefined): boolean {
  return typeof prompt === "string"
    && /\boperation\s*(?:=|:)\s*['"]objective-mapping['"]/i.test(prompt);
}

export function parseInitiativeReviewBinding(value: unknown): InitiativeReviewBinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const binding = value as Record<string, unknown>;
  const artifact = binding["artifactRef"];
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) return null;
  const artifactRef = artifact as Record<string, unknown>;
  const writerToolName = optionalString(binding["writerToolName"]);
  const itemId = optionalString(binding["itemId"]);
  const gate = optionalString(binding["gate"]);
  const repositoryFullName = optionalString(artifactRef["repositoryFullName"]);
  const commitSha = optionalString(artifactRef["commitSha"]);
  const path = optionalString(artifactRef["path"]);
  const providerBlobId = optionalString(artifactRef["providerBlobId"]);
  const revisionId = optionalString(artifactRef["revisionId"]);
  const valueDigest = optionalString(artifactRef["valueDigest"]);
  const repoBlobRef = artifactRef["kind"] === "repo-blob-at-commit" && repositoryFullName && commitSha && path && providerBlobId
    ? { kind: "repo-blob-at-commit" as const, repositoryFullName, commitSha, path, providerBlobId }
    : null;
  const revisionRef = artifactRef["kind"] === "feature-build-revision" && repositoryFullName && revisionId && valueDigest
    ? { kind: "feature-build-revision" as const, repositoryFullName, revisionId, valueDigest }
    : null;
  const parsedArtifactRef: InitiativeReviewArtifactRef | null = repoBlobRef ?? revisionRef;
  const expectedCurrentBaselineId = binding["expectedCurrentBaselineId"];
  const rawEligibleEvidenceActivityIds = binding["eligibleEvidenceActivityIds"];
  const eligibleEvidenceActivityIds = rawEligibleEvidenceActivityIds === undefined
    ? undefined
    : boundedUniqueStrings(rawEligibleEvidenceActivityIds);
  const rawWorkroomRef = binding["workroomRef"];
  const workroomRef = rawWorkroomRef && typeof rawWorkroomRef === "object" && !Array.isArray(rawWorkroomRef)
    ? rawWorkroomRef as Record<string, unknown>
    : null;
  const workroomId = optionalString(workroomRef?.["workroomId"]);
  const workroomRepositoryFullName = optionalString(workroomRef?.["repositoryFullName"]);
  const branchName = optionalString(workroomRef?.["branchName"]);
  const headSha = optionalString(workroomRef?.["headSha"]);
  if (
    !writerToolName?.startsWith("record_initiative_")
    || !itemId?.startsWith("BI-")
    || !gate
    || !parsedArtifactRef
    || (expectedCurrentBaselineId !== undefined
      && expectedCurrentBaselineId !== null
      && typeof expectedCurrentBaselineId !== "string")
    || (rawEligibleEvidenceActivityIds !== undefined && !eligibleEvidenceActivityIds)
    || (rawWorkroomRef !== undefined && (
      workroomRef?.["kind"] !== "workroom-head"
      || !workroomId
      || !workroomRepositoryFullName
      || !branchName
      || !headSha
    ))
    || (workroomRef && workroomRepositoryFullName !== repositoryFullName)
    || (gate === "objective-mapping" && !eligibleEvidenceActivityIds)
  ) return null;
  return {
    writerToolName,
    itemId,
    gate,
    ...(expectedCurrentBaselineId !== undefined
      ? { expectedCurrentBaselineId: expectedCurrentBaselineId as string | null }
      : {}),
    ...(eligibleEvidenceActivityIds ? { eligibleEvidenceActivityIds } : {}),
    ...(workroomRef && workroomId && workroomRepositoryFullName && branchName && headSha
      ? {
        workroomRef: {
          kind: "workroom-head" as const,
          workroomId,
          repositoryFullName: workroomRepositoryFullName,
          branchName,
          headSha,
        },
      }
      : {}),
    artifactRef: parsedArtifactRef,
  };
}

export function validateInitiativeReviewAuthorityScope(
  binding: InitiativeReviewBinding,
  authorityScope: readonly string[] | undefined,
): string | null {
  const exactTools = scopedToolNames(authorityScope);
  if (!exactTools.includes(binding.writerToolName)) {
    return "initiativeReviewBinding writer must match the exact tool authority scope";
  }
  const immutableReaderNames = new Set([...IMMUTABLE_PAGE_READER_TOOLS, "search_source_at_version"]);
  const pageReader = immutablePageReaderForArtifact(binding.artifactRef);
  if (!exactTools.includes(pageReader)) {
    return `initiativeReviewBinding requires ${pageReader} in the exact tool authority scope`;
  }
  if (exactTools.some((name) => name !== binding.writerToolName && !immutableReaderNames.has(name))) {
    return "initiativeReviewBinding tool authority scope may contain only the bound writer and immutable readers";
  }
  if (!authorityScope?.includes(`backlog-item:${binding.itemId}`)) {
    return "initiativeReviewBinding item must match the backlog authority scope";
  }
  return null;
}

export function narrowInitiativeReviewTools<T extends {
  tools: ToolDefinition[];
  toolsForProvider: Array<Record<string, unknown>>;
  deferredTools: ToolDefinition[];
}>(
  input: T,
  requiredNames: readonly string[],
  binding: InitiativeReviewBinding | undefined,
  prompt?: string,
): T {
  if (!binding) return input;
  const exactNames = new Set(requiredNames);
  const currentBaselineId = optionalString(binding.expectedCurrentBaselineId);
  const eligibleEvidenceActivityIds = binding.eligibleEvidenceActivityIds ?? [];
  const objectiveMappingProposal = binding.writerToolName === "record_initiative_evidence"
    && !!currentBaselineId
    && (
      binding.gate === "objective-mapping"
      || (
        binding.gate === "dependency-disposition"
        && !!optionalString(binding.expectedCurrentBaselineId)
        && explicitlyRequestsObjectiveMapping(prompt)
      )
    );
  const baseWriterNames = objectiveMappingProposal
    ? ["operation", "baselineId", "objectiveMappings", "reason"]
    : ["decision", "reason", "findings", "resolvedFindingRefs"];
  const writerPropertyNames = [
    ...baseWriterNames,
    ...(binding.gate === "spec-approval" ? ["profile", "artifactRole", "supersessionDispositions"] : []),
    ...(binding.gate === "classification" ? ["profile"] : []),
  ];
  const requiredWriterNames = [
    ...baseWriterNames,
    ...(binding.gate === "spec-approval" ? ["profile", "artifactRole"] : []),
    ...(binding.gate === "classification" ? ["profile"] : []),
  ];
  const narrowSchema = (schema: Record<string, unknown>) => {
    const properties = schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
      ? schema.properties as Record<string, unknown>
      : {};
    const narrowedProperties = Object.fromEntries(
      writerPropertyNames.flatMap((name) => name in properties ? [[name, properties[name]]] : []),
    );
    const objectiveMappings = narrowedProperties["objectiveMappings"];
    const objectiveMappingsSchema = objectiveMappings && typeof objectiveMappings === "object" && !Array.isArray(objectiveMappings)
      ? objectiveMappings as Record<string, unknown>
      : {};
    const mappingItems = objectiveMappingsSchema["items"] && typeof objectiveMappingsSchema["items"] === "object"
      && !Array.isArray(objectiveMappingsSchema["items"])
      ? objectiveMappingsSchema["items"] as Record<string, unknown>
      : {};
    const mappingProperties = mappingItems["properties"] && typeof mappingItems["properties"] === "object"
      && !Array.isArray(mappingItems["properties"])
      ? mappingItems["properties"] as Record<string, unknown>
      : {};
    const evidenceRefs = mappingProperties["evidenceRefs"] && typeof mappingProperties["evidenceRefs"] === "object"
      && !Array.isArray(mappingProperties["evidenceRefs"])
      ? mappingProperties["evidenceRefs"] as Record<string, unknown>
      : {};
    return {
      type: "object",
      properties: objectiveMappingProposal
        ? {
            ...narrowedProperties,
            operation: { type: "string", enum: ["objective-mapping"] },
            baselineId: { type: "string", enum: [currentBaselineId] },
            objectiveMappings: {
              ...objectiveMappingsSchema,
              items: {
                ...mappingItems,
                properties: {
                  ...mappingProperties,
                  evidenceRefs: {
                    ...evidenceRefs,
                    items: { type: "string", enum: eligibleEvidenceActivityIds },
                    minItems: 1,
                    uniqueItems: true,
                  },
                },
              },
            },
          }
        : narrowedProperties,
      required: requiredWriterNames,
      additionalProperties: false,
    };
  };
  const narrowReaderSchema = (name: string, schema: Record<string, unknown>) => {
    const properties = schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
      ? schema.properties as Record<string, unknown>
      : {};
    if (isImmutablePageReader(name)) {
      const identity = immutableReaderArgumentsFor(binding.artifactRef);
      return {
        type: "object",
        properties: {
          repositoryFullName: { type: "string", enum: [identity.repositoryFullName] },
          path: { type: "string", enum: [identity.path] },
          version: { type: "string", enum: [identity.version] },
          startLine: { type: "number", minimum: 1 },
          cursor: { type: "string" },
          maxLines: { type: "number", minimum: 1, maximum: SOURCE_READ_MAX_LINES },
          maxChars: { type: "number", minimum: 1, maximum: SOURCE_READ_MAX_CHARS },
          expectedBlobId: { type: "string", enum: [identity.expectedBlobId] },
        },
        required: ["repositoryFullName", "path", "version", "expectedBlobId"],
        additionalProperties: false,
      };
    }
    if (name === "search_source_at_version") {
      return {
        type: "object",
        properties: {
          query: properties["query"] ?? { type: "string" },
          version: { type: "string", enum: [immutableArtifactIdentity(binding.artifactRef).version] },
          glob: { type: "string", enum: [immutableArtifactIdentity(binding.artifactRef).path] },
          offset: { type: "number", minimum: 0, maximum: 2000 },
          maxResults: { type: "number", minimum: 1, maximum: 50 },
          expectedBlobId: { type: "string", enum: [immutableArtifactIdentity(binding.artifactRef).expectedBlobId] },
        },
        required: ["query", "version", "glob", "expectedBlobId"],
        additionalProperties: false,
      };
    }
    return schema;
  };
  const boundSchema = (name: string, schema: Record<string, unknown>) =>
    name === binding.writerToolName
      ? narrowSchema(schema)
      : narrowReaderSchema(name, schema);
  const tools = input.tools
    .filter((tool) => exactNames.has(tool.name))
    .map((tool) => ({ ...tool, inputSchema: boundSchema(tool.name, tool.inputSchema) }));
  const toolsForProvider = input.toolsForProvider
    .filter((entry) => {
      const fn = entry["function"];
      return !!fn && typeof fn === "object" && !Array.isArray(fn)
        && exactNames.has(String((fn as Record<string, unknown>)["name"] ?? ""));
    })
    .map((entry) => {
      const fn = entry["function"] as Record<string, unknown>;
      const name = String(fn["name"] ?? "");
      return { ...entry, function: { ...fn, parameters: boundSchema(name, (fn["parameters"] ?? {}) as Record<string, unknown>) } };
    });
  return { ...input, tools, toolsForProvider, deferredTools: [] };
}
