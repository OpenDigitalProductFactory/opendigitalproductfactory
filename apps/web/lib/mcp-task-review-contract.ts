import type { ToolDefinition } from "@/lib/mcp-tools";

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
  artifactRef: {
    kind: "repo-blob-at-commit";
    repositoryFullName: string;
    commitSha: string;
    path: string;
    providerBlobId: string;
  };
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
    name === "read_source_at_version" || name === "search_source_at_version"
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
    || artifactRef["kind"] !== "repo-blob-at-commit"
    || !repositoryFullName
    || !commitSha
    || !path
    || !providerBlobId
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
    artifactRef: {
      kind: "repo-blob-at-commit",
      repositoryFullName,
      commitSha,
      path,
      providerBlobId,
    },
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
  const immutableReaderNames = new Set(["read_source_at_version", "search_source_at_version"]);
  if (!exactTools.includes("read_source_at_version")) {
    return "initiativeReviewBinding requires read_source_at_version in the exact tool authority scope";
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
    if (name === "read_source_at_version") {
      return {
        type: "object",
        properties: {
          repositoryFullName: { type: "string", enum: [binding.artifactRef.repositoryFullName] },
          path: { type: "string", enum: [binding.artifactRef.path] },
          version: { type: "string", enum: [binding.artifactRef.commitSha] },
          startLine: { type: "number", minimum: 1 },
          cursor: { type: "string" },
          maxLines: { type: "number", minimum: 1, maximum: 200 },
          maxChars: { type: "number", minimum: 1, maximum: 3200 },
          expectedBlobId: { type: "string", enum: [binding.artifactRef.providerBlobId] },
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
          version: { type: "string", enum: [binding.artifactRef.commitSha] },
          glob: { type: "string", enum: [binding.artifactRef.path] },
          offset: { type: "number", minimum: 0, maximum: 2000 },
          maxResults: { type: "number", minimum: 1, maximum: 50 },
          expectedBlobId: { type: "string", enum: [binding.artifactRef.providerBlobId] },
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
