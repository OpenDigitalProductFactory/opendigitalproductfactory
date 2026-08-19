import { lazyCrypto } from "@/lib/shared/lazy-node";

export function checksumContent(content: string): string {
  return lazyCrypto().createHash("sha256").update(content).digest("hex");
}
