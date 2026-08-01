// Shared coworker prompt-context sections — BI-45514C4E.
//
// The legacy coworker prompt path (agent-coworker.ts `else` branch) injects two
// context sections the unified prompt-assembler path did NOT: the elevated
// form-fill instruction and the Build Studio context (build section + ideate
// reusability guard + live execution progress). It also auto-resolves the active
// build id on a /build route, which the unified path skipped — so a Build-Studio
// coworker on the unified path silently lost both its build context AND its
// build-scoped tool filtering.
//
// This module is the single implementation of that logic, consumed by the
// unified path so it reaches parity with legacy. (The legacy branch keeps its
// inline copy for now — a strict no-op for current default installs; pointing it
// at this module is a follow-up SSoT cleanup.) The functions are thin wrappers
// over the same helpers the legacy path already calls, so output is identical.

import { prisma } from "@dpf/db";

import { buildFormAssistInstruction, type AgentFormAssistContext } from "@/lib/agent-form-assist";
import { getBuildContextSection } from "@/lib/build-agent-prompts";
import { getFeatureBuildForContext } from "@/lib/feature-build-data";
import type { ChatMessage } from "@/lib/ai-inference";

/** The elevated form-fill instruction, or null when it does not apply. */
export function formAssistSection(input: {
  elevatedFormFillEnabled?: boolean;
  formAssistContext?: AgentFormAssistContext;
}): string | null {
  if (input.elevatedFormFillEnabled && input.formAssistContext) {
    return buildFormAssistInstruction(input.formAssistContext);
  }
  return null;
}

/**
 * Resolve the active build id for a coworker turn. When no explicit build id is
 * given and the route is under /build, resolve from the capsule's linked build
 * (on a /build/work/<capsuleId> page) or fall back to the user's latest active
 * build. Mirrors the legacy branch's auto-resolution so the unified path injects
 * build context and applies build-scoped tool filtering on /build routes too.
 */
export async function resolveRouteBuildId(input: {
  buildId?: string;
  routeContext: string;
  userId: string;
}): Promise<string | undefined> {
  let resolvedBuildId = input.buildId;
  if (!resolvedBuildId && input.routeContext.startsWith("/build")) {
    const capsuleMatch = input.routeContext.match(/\/build\/work\/(WC-[A-Z0-9]+)/);
    if (capsuleMatch) {
      const capsule = await prisma.workCapsule.findUnique({
        where: { capsuleId: capsuleMatch[1] },
        select: { featureBuildId: true },
      });
      if (capsule?.featureBuildId) {
        const build = await prisma.featureBuild.findUnique({
          where: { id: capsule.featureBuildId },
          select: { buildId: true },
        });
        resolvedBuildId = build?.buildId ?? undefined;
      }
    } else {
      const latestBuild = await prisma.featureBuild.findFirst({
        where: { createdById: input.userId, phase: { notIn: ["complete", "failed", "abandoned"] } },
        orderBy: { updatedAt: "desc" },
        select: { buildId: true },
      });
      resolvedBuildId = latestBuild?.buildId ?? undefined;
    }
  }
  return resolvedBuildId;
}

/**
 * Build the Build Studio context sections for a resolved build: the build
 * context section, the ideate reusability-already-asked guard, and live build
 * execution progress. Returns an ordered list of prompt sections (empty when the
 * build has no context). Fail-open on the progress query, matching legacy.
 */
export async function buildBuildContextSections(input: {
  buildId: string;
  userId: string;
  chatHistory: ChatMessage[];
}): Promise<string[]> {
  const sections: string[] = [];
  const buildCtx = await getFeatureBuildForContext(input.buildId, input.userId);
  if (buildCtx) {
    sections.push(await getBuildContextSection(buildCtx));

    // The ideate prompt says "Ask ONE question about reusability" but the model
    // re-reads the instruction each call and re-asks. Inject a guard when the
    // question was already asked and answered.
    if (buildCtx.phase === "ideate" && input.chatHistory.length > 2) {
      const assistantMsgs = input.chatHistory
        .filter((m) => m.role === "assistant")
        .map((m) => (typeof m.content === "string" ? m.content : ""));
      const askedReusability = assistantMsgs.some((msg) =>
        /reusab|other.*provider|other.*certification|configurable|generic/i.test(msg),
      );
      if (askedReusability) {
        sections.push(
          "\n--- IMPORTANT: Reusability question already asked ---\n" +
            "You have ALREADY asked the user about reusability/scope. The user answered in the conversation history above. " +
            "Do NOT ask again. Skip Step 2 of the ideate process. Proceed directly to Step 3 (design document) using the user's answer.",
        );
      }
    }
  }

  // Live build execution progress so the user can interact mid-build.
  try {
    const buildRecord = await prisma.featureBuild.findUnique({
      where: { buildId: input.buildId },
      select: { buildExecState: true, verificationOut: true, taskResults: true, phase: true },
    });
    if (buildRecord?.phase === "build" && buildRecord.buildExecState) {
      const execState = buildRecord.buildExecState as Record<string, unknown>;
      const progressLines = ["", "--- Build Execution Progress ---", `Pipeline step: ${execState.step ?? "unknown"}`];
      if (execState.containerId) progressLines.push(`Sandbox: ${execState.containerId}`);
      if (execState.error) progressLines.push(`Last error: ${String(execState.error).slice(0, 300)}`);
      if (buildRecord.taskResults) {
        const tasks = buildRecord.taskResults as Record<string, unknown>;
        if (tasks.toolsExecuted) progressLines.push(`Tools executed: ${(tasks.toolsExecuted as string[]).join(", ")}`);
      }
      if (buildRecord.verificationOut) {
        const verify = buildRecord.verificationOut as Record<string, unknown>;
        progressLines.push(`Tests: ${verify.testsPassed ? "PASS" : "FAIL"}. Typecheck: ${verify.typeCheckPassed ? "PASS" : "FAIL"}.`);
      }
      sections.push(progressLines.join("\n"));
    }
  } catch {
    // Non-fatal — proceed without progress context.
  }

  return sections;
}

/**
 * Convenience: resolve the build id and assemble the full ordered set of extra
 * coworker context sections (form-assist first, then build context) for the
 * unified path. Returns the resolved build id (so the caller can apply
 * build-scoped tool filtering) alongside the sections.
 */
export async function buildCoworkerExtraSections(input: {
  buildId?: string;
  routeContext: string;
  userId: string;
  chatHistory: ChatMessage[];
  elevatedFormFillEnabled?: boolean;
  formAssistContext?: AgentFormAssistContext;
}): Promise<{ resolvedBuildId: string | undefined; sections: string[] }> {
  const sections: string[] = [];
  const formAssist = formAssistSection(input);
  if (formAssist) sections.push("", formAssist);

  const resolvedBuildId = await resolveRouteBuildId(input);
  if (resolvedBuildId) {
    sections.push(...(await buildBuildContextSections({ buildId: resolvedBuildId, userId: input.userId, chatHistory: input.chatHistory })));
  }
  return { resolvedBuildId, sections };
}
