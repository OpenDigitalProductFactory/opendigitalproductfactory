import type { FingerprintRedactionResult, RedactionStatus } from "./discovery-fingerprint-types";

const IPV4_PATTERN =
  /\b(?:(?:10)|(?:127)|(?:172\.(?:1[6-9]|2\d|3[0-1]))|(?:192\.168))\.(?:\d{1,3}\.){1,2}\d{1,3}\b/g;
const MAC_PATTERN = /\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\b/gi;
const INTERNAL_HOSTNAME_PATTERN =
  /\b[a-z0-9][a-z0-9-]*(?:-[a-z0-9][a-z0-9-]*)*\.(?:internal|corp|local|lan|home|intranet)(?:\.[a-z0-9.-]+)?\b/gi;
const SERIAL_PATTERN = /\b(?:serial|sn|service tag)\s*[:#-]?\s*[a-z0-9-]+\b/gi;
const SECRET_PATTERN = /\b(?:authorization:\s*bearer|api[_-]?key|access[_-]?token|secret|password)\b/i;

export function redactFingerprintEvidence(evidence: unknown): FingerprintRedactionResult {
  const redactedFields = new Set<string>();
  const blockedReasons = new Set<string>();

  const normalizedEvidence = redactValue(evidence, "", redactedFields, blockedReasons);
  const status: RedactionStatus =
    blockedReasons.size > 0 ? "blocked_sensitive" : redactedFields.size > 0 ? "redacted" : "not_required";

  return {
    normalizedEvidence,
    status,
    redactedFields: Array.from(redactedFields).sort(),
    blockedReasons: Array.from(blockedReasons).sort(),
  };
}

function redactValue(
  value: unknown,
  path: string,
  redactedFields: Set<string>,
  blockedReasons: Set<string>,
): unknown {
  if (typeof value === "string") {
    return redactString(value, path, redactedFields, blockedReasons);
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => redactValue(entry, appendPath(path, String(index)), redactedFields, blockedReasons));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        redactValue(entry, appendPath(path, key), redactedFields, blockedReasons),
      ]),
    );
  }

  return value;
}

function redactString(
  value: string,
  path: string,
  redactedFields: Set<string>,
  blockedReasons: Set<string>,
): string {
  if (SECRET_PATTERN.test(value)) {
    blockedReasons.add("secret_like_token");
    return "[blocked-sensitive]";
  }

  let redacted = value
    .replace(MAC_PATTERN, "[redacted-mac]")
    .replace(IPV4_PATTERN, "[redacted-ip]")
    .replace(INTERNAL_HOSTNAME_PATTERN, "[redacted-hostname]")
    .replace(SERIAL_PATTERN, "[redacted-serial]");

  if (redacted !== value) {
    redactedFields.add(topLevelPath(path));
  }

  return redacted;
}

function appendPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function topLevelPath(path: string): string {
  return path.split(".")[0] || "evidence";
}
