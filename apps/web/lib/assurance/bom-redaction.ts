import type { CycloneDxDocument } from "./bom-types";

const INTERNAL_KEYS = new Set([
  "absolutePath",
  "apiKey",
  "internalUrl",
  "localPath",
  "requestedByUserId",
  "routeContext",
  "secret",
  "sourceDigest",
  "sourcePath",
  "toolExecutionId",
  "userId",
  "workspacePath",
]);

const INTERNAL_PROPERTY_NAMES = new Set([
  "dpf:routeContext",
  "dpf:sourceDigest",
  "dpf:workspacePath",
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInternalKey(key: string): boolean {
  return INTERNAL_KEYS.has(key);
}

function isInternalProperty(property: unknown): boolean {
  if (!isPlainRecord(property)) return false;
  const name = typeof property.name === "string" ? property.name : "";
  return INTERNAL_PROPERTY_NAMES.has(name);
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map((entry) => redactValue(entry))
      .filter((entry) => entry !== undefined);
  }

  if (!isPlainRecord(value)) return value;

  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isInternalKey(key)) continue;

    if (key === "properties" && Array.isArray(entry)) {
      redacted[key] = redactValue(entry.filter((property) => !isInternalProperty(property)));
      continue;
    }

    const child = redactValue(entry);
    if (child !== undefined) {
      redacted[key] = child;
    }
  }

  return redacted;
}

function metadataProperties(metadata: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(metadata.properties)
    ? metadata.properties.filter(isPlainRecord)
    : [];
}

export function createShareableCycloneDxBom(input: CycloneDxDocument): CycloneDxDocument {
  const redacted = redactValue(input) as CycloneDxDocument;
  const metadata = redacted.metadata ?? {};

  return {
    ...redacted,
    metadata: {
      ...metadata,
      properties: [
        ...metadataProperties(metadata),
        { name: "dpf:exportProfile", value: "shareable" },
      ],
    },
  };
}
