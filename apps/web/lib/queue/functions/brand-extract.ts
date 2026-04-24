import { inngest } from "../inngest-client";

export type RunBrandExtractionInput = {
  organizationId: string;
  taskRunId: string;
  userId: string;
  threadId: string | null;
  sources: {
    url?: string;
    codebasePath?: string;
    uploadIds?: string[];
  };
};

/**
 * Pure core handler for brand extraction. The Inngest function wraps
 * this with retry/concurrency config; tests exercise this function
 * directly.
 */
export async function runBrandExtraction(input: RunBrandExtractionInput): Promise<void> {
  const { prisma } = await import("@dpf/db");
  const { extractBrandDesignSystem } = await import("@/lib/brand/extraction");
  const { pushThreadProgress } = await import("@/lib/tak/thread-progress");
  const { createTaskArtifact, createTaskMessage } = await import("@/lib/tak/task-records");
  const { designSystemToThemeTokens } = await import("@/lib/brand/apply");

  // Resolve uploads from AgentAttachment IDs if supplied.
  let uploads: Array<{ name: string; mimeType: string; data: Buffer }> | undefined;
  let taskRunRecordId: string | null = null;
  let taskContextId: string | null = input.threadId ?? input.taskRunId;
  if (input.sources.uploadIds && input.sources.uploadIds.length > 0) {
    try {
      const attachments = await prisma.agentAttachment.findMany({
        where: { id: { in: input.sources.uploadIds } },
        select: { id: true, filename: true, mimeType: true, data: true },
      });
      uploads = attachments.map((a) => ({
        name: a.filename,
        mimeType: a.mimeType,
        data: Buffer.isBuffer(a.data) ? a.data : Buffer.from(a.data as unknown as ArrayBufferLike),
      }));
    } catch {
      // Swallow; extraction can proceed without uploads.
    }
  }

  try {
    const taskRun = await prisma.taskRun.findUnique({
      where: { taskRunId: input.taskRunId },
      select: { id: true, contextId: true },
    });
    taskRunRecordId = taskRun?.id ?? null;
    taskContextId = taskRun?.contextId ?? taskContextId;
  } catch {
    // Best-effort lookup; helper can resolve again if needed.
  }

  try {
    // Mark TaskRun working (idempotent; submitted is the initial envelope state).
    await prisma.taskRun.update({
      where: { taskRunId: input.taskRunId },
      data: { status: "working", startedAt: new Date() },
    });
  } catch {
    // Best-effort.
  }

  const emit = async (progress: { stage: string; message: string; percent: number }): Promise<void> => {
    await pushThreadProgress(input.threadId, input.taskRunId, {
      type: "brand:extract.progress",
      taskRunId: input.taskRunId,
      stage: progress.stage,
      message: progress.message,
      percent: progress.percent,
    });
    await createTaskMessage({
      taskRunId: input.taskRunId,
      taskRunRecordId,
      contextId: taskContextId,
      role: "system",
      messageType: "progress",
      content: progress.message,
      metadata: {
        eventType: "brand:extract.progress",
        stage: progress.stage,
        percent: progress.percent,
      },
    }).catch(() => {});
  };

  let result;
  try {
    result = await extractBrandDesignSystem(
      {
        organizationId: input.organizationId,
        taskRunId: input.taskRunId,
        userId: input.userId,
        threadId: input.threadId,
        sources: {
          url: input.sources.url,
          codebasePath: input.sources.codebasePath,
          uploads,
        },
      },
      emit,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await pushThreadProgress(input.threadId, input.taskRunId, {
      type: "brand:extract.failed",
      taskRunId: input.taskRunId,
      error: message,
    });
    try {
      await prisma.taskRun.update({
        where: { taskRunId: input.taskRunId },
        data: { status: "failed", completedAt: new Date() },
      });
    } catch {
      // Best-effort.
    }
    await createTaskMessage({
      taskRunId: input.taskRunId,
      taskRunRecordId,
      contextId: taskContextId,
      role: "agent",
      messageType: "status",
      content: `Brand extraction failed: ${message}`,
      metadata: {
        eventType: "brand:extract.failed",
        error: message,
      },
    }).catch(() => {});
    if (input.threadId) {
      try {
        await prisma.agentMessage.create({
          data: {
            threadId: input.threadId,
            role: "assistant",
            content: `I couldn't finish the brand extraction: ${message}. Want to try again with a different URL or source?`,
          },
        });
      } catch {
        // Best-effort.
      }
    }
    throw err;
  }

  const ds = result.designSystem;

  // Write the canonical substrate.
  await prisma.organization.update({
    where: { id: input.organizationId },
    data: { designSystem: JSON.parse(JSON.stringify(ds)) },
  });

  // Derive runtime theme tokens and upsert BrandingConfig so the
  // storefront/admin themers pick up the new brand automatically.
  let themeTokens: unknown = null;
  try {
    themeTokens = designSystemToThemeTokens(ds);
    await prisma.brandingConfig.upsert({
      where: { scope: `organization:${input.organizationId}` },
      update: {
        tokens: JSON.parse(JSON.stringify(themeTokens)),
        organizationId: input.organizationId,
      },
      create: {
        scope: `organization:${input.organizationId}`,
        label: ds.identity.name || "Organization",
        tokens: JSON.parse(JSON.stringify(themeTokens)),
        organizationId: input.organizationId,
      },
    });
  } catch {
    // Non-fatal: substrate is written; theme refresh can be re-triggered later.
  }

  // Mark TaskRun completed.
  try {
    await prisma.taskRun.update({
      where: { taskRunId: input.taskRunId },
      data: { status: "completed", completedAt: new Date() },
    });
  } catch {
    // Best-effort.
  }

  // Final progress payload so reconnecting panels see completion.
  const summary = `Extracted your brand from ${result.sourcesUsed.length} source${result.sourcesUsed.length === 1 ? "" : "s"}. Primary color ${ds.palette.primary}, body font ${ds.typography.families.sans}. Confidence: ${(ds.confidence.overall * 100).toFixed(0)}%.`;

  await pushThreadProgress(input.threadId, input.taskRunId, {
    type: "brand:extract.complete",
    taskRunId: input.taskRunId,
    summary,
  });

  await createTaskMessage({
    taskRunId: input.taskRunId,
    taskRunRecordId,
    contextId: taskContextId,
    role: "agent",
    messageType: "status",
    content: summary,
    metadata: {
      eventType: "brand:extract.complete",
      confidence: ds.confidence.overall,
      sourceCount: result.sourcesUsed.length,
    },
  }).catch(() => {});

  await createTaskArtifact({
    taskRunId: input.taskRunId,
    taskRunRecordId,
    artifactType: "design-system",
    name: "Extracted brand design system",
    mimeType: "application/json",
    summary,
    content: ds,
    metadata: {
      sourceCount: result.sourcesUsed.length,
      sourcesUsed: result.sourcesUsed,
      durationMs: result.durationMs,
    },
  }).catch(() => {});

  if (themeTokens) {
    await createTaskArtifact({
      taskRunId: input.taskRunId,
      taskRunRecordId,
      artifactType: "theme-tokens",
      name: "Derived brand theme tokens",
      mimeType: "application/json",
      summary: "Runtime branding tokens derived from the extracted design system.",
      content: themeTokens,
      metadata: {
        sourceArtifactType: "design-system",
      },
    }).catch(() => {});
  }

  // Post a summary message to the thread so the coworker "returns" with results.
  if (input.threadId) {
    try {
      await prisma.agentMessage.create({
        data: {
          threadId: input.threadId,
          role: "assistant",
          content: `${summary}\n\nOpen Admin > Branding to review and apply.`,
        },
      });
    } catch {
      // Best-effort.
    }
  }
}

export const brandExtract = inngest.createFunction(
  {
    id: "brand/extract",
    retries: 1,
    concurrency: [{ key: "event.data.organizationId", limit: 1 }],
    triggers: [{ event: "brand/extract.run" }],
  },
  async ({ event, step }) => {
    await step.run("run-brand-extraction", async () => {
      await runBrandExtraction(event.data as unknown as RunBrandExtractionInput);
    });
    return { ok: true };
  },
);
