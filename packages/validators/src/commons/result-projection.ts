import { isBoundedTrustedJson } from "../bounded-trusted-json.js";

export const HIVE_RESULT_BUNDLE_SCHEMA_VERSION = "dpf.hive-result/1" as const;

const HIVE_RESULT_ALLOWED_TOP_LEVEL_FIELDS = new Set([
  "schemaVersion",
  "result",
  "evidence",
  "provenance",
  "attribution",
  "review",
  "disposition",
  "sourceReceipt",
]);

const HIVE_RESULT_FORBIDDEN_FIELD = /(backlog|workcapsule|featurebuild|buildplan|priority|estimate|discussion|roadmap|customercontext|customername|customerid|localrecord|localdatabase|dbid)/i;

export interface HiveResultProjection {
  projected: Record<string, unknown>;
  violations: string[];
}

function normalizePayloadKey(key: string): string {
  return key.replace(/[_\-\s]/g, "").toLowerCase();
}

function isPayloadRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectResultValue(value: unknown, path: string, violations: string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => projectResultValue(item, `${path}[${index}]`, violations));
  }
  if (!isPayloadRecord(value)) return value;

  const projected: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (HIVE_RESULT_FORBIDDEN_FIELD.test(normalizePayloadKey(key))) {
      violations.push(`forbidden-field:${childPath}`);
      continue;
    }
    const projectedChild = projectResultValue(child, childPath, violations);
    // Legacy assignment omitted __proto__ from the serialized own keys. Keep
    // those issued hash bytes, without mutating the new object's prototype.
    if (key !== "__proto__") Object.defineProperty(projected, key, { value: projectedChild, enumerable: true, writable: true, configurable: true });
  }
  return projected;
}

/**
 * Build the only payload shape permitted across the public Hive result channel.
 * Unknown top-level domains and source-local planning fields are fail-visible
 * and removed before a caller can serialize the projection.
 */
export function projectHiveResultBundle(payload: unknown): HiveResultProjection {
  if (!isPayloadRecord(payload)) return { projected: {}, violations: ["payload:invalid"] };
  if (!isBoundedTrustedJson(payload)) return { projected: {}, violations: ["payload:not-bounded-json"] };
  const violations: string[] = [];
  const projected: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (!HIVE_RESULT_ALLOWED_TOP_LEVEL_FIELDS.has(key)) {
      violations.push(`non-allowed-field:${key}`);
      continue;
    }
    projected[key] = projectResultValue(value, key, violations);
  }
  if (projected.schemaVersion !== HIVE_RESULT_BUNDLE_SCHEMA_VERSION) {
    violations.push("schemaVersion:unsupported");
  }
  return { projected, violations };
}
