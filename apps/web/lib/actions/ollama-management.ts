// apps/web/lib/actions/ollama-management.ts
"use server";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getOllamaBaseUrl } from "@/lib/ollama-url";
import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";

async function requireOllamaAdmin() {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) throw new Error("Unauthorized");
  if (!can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_provider_connections")) {
    throw new Error("Insufficient permissions");
  }
  const provider = await prisma.modelProvider.findUnique({ where: { providerId: "ollama" } });
  return { user, provider };
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
    await requireOllamaAdmin();
    const baseUrl = getOllamaBaseUrl();
    const res = await fetch(`${baseUrl}/api/tags`, { cache: "no-store" });
    if (!res.ok) return { models: [], error: `Ollama unreachable (${res.status})` };
    const data = await res.json();
    const models: OllamaModelInfo[] = (data.models ?? []).map((m: Record<string, unknown>) => ({
      name: String(m.name ?? ""),
      size: Number(m.size ?? 0),
      sizeGb: (Number(m.size ?? 0) / 1e9).toFixed(1),
      modified_at: String(m.modified_at ?? ""),
      digest: String(m.digest ?? "").slice(0, 12),
      parameterSize: String((m.details as Record<string, unknown>)?.parameter_size ?? ""),
      quantization: String((m.details as Record<string, unknown>)?.quantization_level ?? ""),
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

export async function getOllamaRunningModels(): Promise<{ models: OllamaRunningModel[]; error?: string }> {
  try {
    await requireOllamaAdmin();
    const baseUrl = getOllamaBaseUrl();
    const res = await fetch(`${baseUrl}/api/ps`, { cache: "no-store" });
    if (!res.ok) return { models: [], error: `Ollama unreachable (${res.status})` };
    const data = await res.json();
    const models: OllamaRunningModel[] = (data.models ?? []).map((m: Record<string, unknown>) => ({
      name: String(m.name ?? ""),
      sizeVram: Number(m.size_vram ?? 0),
      sizeVramGb: (Number(m.size_vram ?? 0) / 1e9).toFixed(1),
    }));
    return { models };
  } catch (e) {
    return { models: [], error: e instanceof Error ? e.message : "Failed to get running models" };
  }
}

export async function pullOllamaModel(modelName: string): Promise<{ success: boolean; error?: string }> {
  try {
    await requireOllamaAdmin();
    const baseUrl = getOllamaBaseUrl();
    const res = await fetch(`${baseUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName, stream: false }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `Pull failed: ${text}` };
    }
    revalidatePath("/platform/ai/providers/ollama");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Pull failed" };
  }
}

export async function deleteOllamaModel(modelName: string): Promise<{ success: boolean; error?: string }> {
  try {
    await requireOllamaAdmin();
    const baseUrl = getOllamaBaseUrl();
    const res = await fetch(`${baseUrl}/api/delete`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `Delete failed: ${text}` };
    }

    // Clean up DB records
    await prisma.modelProfile.deleteMany({ where: { providerId: "ollama", modelId: modelName } });
    await prisma.discoveredModel.deleteMany({ where: { providerId: "ollama", modelId: modelName } });

    revalidatePath("/platform/ai/providers/ollama");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Delete failed" };
  }
}
