import { revalidateTag } from "next/cache";

export function revalidatePortalContext(tags: string[] = []): void {
  const scopedTags = tags.map((tag) => tag.trim()).filter(Boolean);
  const uniqueTags = Array.from(new Set(scopedTags.length > 0 ? scopedTags : ["portal-context"]));
  try {
    for (const tag of uniqueTags) {
      revalidateTag(tag, "max");
    }
  } catch {
    // Revalidation is best-effort outside a Next request/runtime boundary.
  }
}

export function revalidatePortalContextForBuild(buildId: string): void {
  revalidatePortalContext([`portal-context:build:${buildId}`]);
}

export function revalidatePortalContextForCapsule(capsuleId: string): void {
  revalidatePortalContext([`portal-context:capsule:${capsuleId}`]);
}

export function revalidatePortalContextForThread(threadId: string): void {
  revalidatePortalContext([`portal-context:thread:${threadId}`]);
}

export function revalidatePortalContextForUser(userId: string): void {
  revalidatePortalContext([`portal-context:user:${userId}`]);
}

export function revalidatePortalContextForTaskRun(taskRunId: string, threadId?: string | null): void {
  revalidatePortalContext([
    `portal-context:task-run:${taskRunId}`,
    threadId ? `portal-context:thread:${threadId}` : "",
  ]);
}
