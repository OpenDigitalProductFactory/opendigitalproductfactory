import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";

export function foregroundRequestDigest(input: {
  userId: string; agentId: string; threadId: string; userMessageId: string;
  routeContext: string; content: string; coworkerMode: "advise" | "act"; extras: Record<string, unknown>; deadlineAt: string;
}): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}
