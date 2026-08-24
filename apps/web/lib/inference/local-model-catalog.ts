import { GOVERNED_LOCAL_REVIEWER } from "@/lib/routing/local-inference-runtime-policy";

export type LocalModelCategory = "coworkers" | "coding" | "embeddings" | "general";

export type LocalCatalogModel = {
  id: string; name: string; description: string; vramGb: number; contextK: number;
  toolUse: boolean; category: LocalModelCategory; governanceRole?: "high-trust-reviewer";
};

export const LOCAL_MODEL_CATALOG: LocalCatalogModel[] = [
  { id: "ai/qwen3:8B-Q4_K_M", name: "Qwen3 8B", description: "Strong tool use on most recent GPUs.", vramGb: 6, contextK: 32, toolUse: true, category: "coworkers" },
  { id: "ai/qwen3:14B-Q6_K", name: "Qwen3 14B", description: "Stronger tool use with more memory pressure.", vramGb: 12, contextK: 32, toolUse: true, category: "coworkers" },
  { id: GOVERNED_LOCAL_REVIEWER.modelId, name: "Qwen3.8 27B", description: "Governed high-trust reviewer for thorough long-context work. Best with 24 GB or more graphics memory.", vramGb: 18, contextK: 262, toolUse: true, category: "coworkers", governanceRole: GOVERNED_LOCAL_REVIEWER.role },
  { id: "ai/qwen3.6:35B-A3B-UD-Q4_K_M", name: "Qwen3.6 35B-A3B", description: "Faster mixture-of-experts model for high-memory systems.", vramGb: 22, contextK: 32, toolUse: true, category: "coworkers" },
  { id: "ai/qwen2.5-coder:14b", name: "Qwen2.5 Coder 14B", description: "Coding-focused model with long context and structured output.", vramGb: 10, contextK: 128, toolUse: true, category: "coding" },
  { id: "ai/qwen2.5-coder:7b", name: "Qwen2.5 Coder 7B", description: "Lighter coding model for smaller GPUs.", vramGb: 6, contextK: 128, toolUse: true, category: "coding" },
  { id: "ai/nomic-embed-text-v1.5", name: "Nomic Embed Text v1.5", description: "Embedding model used by semantic search and memory.", vramGb: 1, contextK: 8, toolUse: false, category: "embeddings" },
  { id: "ai/qwen3:4B-UD-Q4_K_XL", name: "Qwen3 4B", description: "Compact general model for CPU or low-memory systems.", vramGb: 3, contextK: 32, toolUse: true, category: "general" },
];

export function localModelComparisonKey(reference: string): string {
  return reference.trim().replace(/^docker\.io\//i, "").replace(/^huggingface\.co\//i, "hf.co/").replace(/:latest$/i, "").toLowerCase();
}

export function formatModelBytes(bytes: number | null): string {
  if (bytes === null) return "Size unavailable";
  const gib = bytes / 1024 ** 3;
  return gib >= 1 ? `${gib.toFixed(2)} GiB` : `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
}
