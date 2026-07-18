export function collectSensitiveText(value: unknown, collected: Set<string>): void {
  if (typeof value === "string") {
    if (value.length >= 4) collected.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectSensitiveText(item, collected));
    return;
  }
  if (value !== null && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((item) => collectSensitiveText(item, collected));
  }
}

export function redactConnectorText(value: string, suppliedSecrets: Iterable<string> = []): string {
  let redacted = value;
  for (const secret of suppliedSecrets) {
    if (secret.length >= 4) redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, "$1 [REDACTED]")
    .replace(/([?&](?:access_token|refresh_token|token|api_key|apikey|password|secret|signature)=)[^&#\s]*/gi, "$1[REDACTED]")
    .replace(/(https?:\/\/)[^/@\s]+@/gi, "$1[REDACTED]@")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
