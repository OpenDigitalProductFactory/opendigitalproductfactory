import type { ToolDefinition } from "@/lib/mcp-tools";

export type InitiativeReviewBinding = {
  writerToolName: string;
  itemId: string;
  gate: string;
  expectedCurrentBaselineId?: string | null;
  artifactRef: {
    kind: "repo-blob-at-commit";
    repositoryFullName: string;
    commitSha: string;
    path: string;
    providerBlobId: string;
  };
};

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function requiredToolNames(authorityScope: readonly string[] | undefined): string[] {
  return [...new Set((authorityScope ?? []).flatMap((entry) => {
    const name = entry.startsWith("tool:") ? entry.slice("tool:".length).trim() : "";
    return name ? [name] : [];
  }))].slice(0, 4);
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
  ) return null;
  return {
    writerToolName,
    itemId,
    gate,
    ...(expectedCurrentBaselineId !== undefined
      ? { expectedCurrentBaselineId: expectedCurrentBaselineId as string | null }
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
  const exactTools = requiredToolNames(authorityScope);
  if (!exactTools.includes(binding.writerToolName)) {
    return "initiativeReviewBinding writer must match the exact tool authority scope";
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
}>(input: T, requiredNames: readonly string[], binding: InitiativeReviewBinding | undefined): T {
  if (!binding) return input;
  const exactNames = new Set(requiredNames);
  const compactResearchReceipt = binding.gate === "research"
    && binding.writerToolName === "record_initiative_evidence";
  const objectiveMappingProposal = binding.gate === "objective-mapping"
    && binding.writerToolName === "record_initiative_evidence";
  const baseWriterNames = objectiveMappingProposal
    ? ["operation", "baselineId", "objectiveMappings", "reason"]
    : compactResearchReceipt
      ? ["decision"]
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
    return {
      type: "object",
      properties: objectiveMappingProposal
        ? {
            ...narrowedProperties,
            operation: { type: "string", enum: ["objective-mapping"] },
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
