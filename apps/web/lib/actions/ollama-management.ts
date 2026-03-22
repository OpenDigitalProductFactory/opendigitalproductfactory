// apps/web/lib/actions/ollama-management.ts
// Local model management server actions.
// With Docker Model Runner, model pull/delete is done via Docker Desktop CLI:
//   docker model pull ai/llama3.2:1B-Q8_0
//   docker model list
//   docker model rm <model>
// This file provides read-only listing via the OpenAI-compatible API.
"use server";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getOllamaBaseUrl } from "@/lib/ollama-url";

async function requireAdmin() {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) throw new Error("Unauthorized");
  if (!can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_provider_connections")) {
    throw new Error("Insufficient permissions");
  }
  return { user };
}

export type OllamaModelInfo = {
  name: string;
  size: number;
  sizeGb: string;
  modified_at: string;
  digest: string;
  parameterSize: string;
  quantization: string;
};

export async function listOllamaModels(): Promise<{ models: OllamaModelInfo[]; error?: string }> {
  try {
    await requireAdmin();
    const baseUrl = getOllamaBaseUrl();
    const url = baseUrl.endsWith("/v1") ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { models: [], error: `Local inference unreachable (${res.status})` };
    const data = (await res.json()) as { data?: Array<{ id: string; created?: number; owned_by?: string }> };
    const models: OllamaModelInfo[] = (data.data ?? []).map((m) => ({
      name: m.id,
      size: 0,
      sizeGb: "—",
      modified_at: m.created ? new Date(m.created * 1000).toISOString() : "",
      digest: "",
      parameterSize: "",
      quantization: "",
    }));
    return { models };
  } catch (e) {
    return { models: [], error: e instanceof Error ? e.message : "Failed to list models" };
  }
}

export type OllamaRunningModel = {
  name: string;
  sizeVram: number;
  sizeVramGb: string;
};

// Docker Model Runner doesn't expose running model / VRAM info
export async function getOllamaRunningModels(): Promise<{ models: OllamaRunningModel[]; error?: string }> {
  return { models: [] };
}

// Model pull/delete are handled via Docker Desktop CLI, not through the app
export async function pullOllamaModel(_modelName: string): Promise<{ success: boolean; error?: string }> {
  return { success: false, error: "Use 'docker model pull <name>' from the command line to add models." };
}

export async function deleteOllamaModel(_modelName: string): Promise<{ success: boolean; error?: string }> {
  return { success: false, error: "Use 'docker model rm <name>' from the command line to remove models." };
}
