import type { WordPressCredential } from "./connector";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function readStoredWordPressCredential(fieldsEnvelope: unknown): WordPressCredential | null {
  const fields = record(fieldsEnvelope);
  const reconnect = record(fields.reconnectFields);
  const secrets = record(fields.secretFields);
  const siteUrl = reconnect.siteUrl ?? fields.siteUrl;
  const username = reconnect.username ?? fields.username;
  const applicationPassword = secrets.applicationPassword ?? fields.applicationPassword;
  return typeof siteUrl === "string" && typeof username === "string" && typeof applicationPassword === "string"
    ? { siteUrl, username, applicationPassword }
    : null;
}

export function readWordPressPublicPublicationPolicy(fieldsEnvelope: unknown): boolean {
  return record(record(fieldsEnvelope).safeProjection).publicPublicationEnabled === true;
}
