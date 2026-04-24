import { isBrandDesignSystem, type BrandDesignSystem } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function extractBrandDesignSystemFromArtifacts(artifacts: unknown): BrandDesignSystem | null {
  if (!Array.isArray(artifacts)) return null;

  for (const artifact of artifacts) {
    if (!isRecord(artifact) || !Array.isArray(artifact.parts)) continue;
    for (const part of artifact.parts) {
      if (!isRecord(part) || part.type !== "design-system") continue;
      if (isBrandDesignSystem(part.data)) {
        return part.data;
      }
    }
  }

  return null;
}

export function extractBrandDesignSystemFromTaskResponse(payload: unknown): BrandDesignSystem | null {
  if (!isRecord(payload)) return null;
  const task = isRecord(payload.task) ? payload.task : payload;
  return extractBrandDesignSystemFromArtifacts(task.artifacts);
}
