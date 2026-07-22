import { readFileSync } from "node:fs";

export function loadEdgeMtlsProxySecret(
  env: Record<string, string | undefined> = process.env,
): string {
  const path = env.DPF_EDGE_MTLS_PROXY_SECRET_FILE?.trim();
  if (!path) throw new Error("Edge mTLS proxy assertion file is not configured");
  const secret = readFileSync(path, "utf8").trim();
  if (secret.length < 32) throw new Error("Edge mTLS proxy assertion must be at least 32 characters");
  if (secret.length > 256 || /\s/.test(secret)) {
    throw new Error("Edge mTLS proxy assertion has an invalid format");
  }
  return secret;
}
