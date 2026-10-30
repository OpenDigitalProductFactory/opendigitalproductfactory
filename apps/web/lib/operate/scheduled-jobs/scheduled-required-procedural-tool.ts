import { readWorkroomStageTaskConfig } from "@/lib/scheduling/workroom-stage-task-config";
import { isCoworkerSelfTaskId, coworkerSelfTaskRequiredTool } from "./coworker-self-tasks";

type RequiredProceduralTool = {
  name: string;
  args: Record<string, unknown>;
  hasRecentArtifact?: () => Promise<boolean>;
};

/** Shared by execution and reporting eligibility; a mode cannot erase this obligation. */
export function getRequiredProceduralToolForScheduledTask(taskId: string, agentId: string): RequiredProceduralTool | null {
  if (taskId === "discovery-taxonomy-gap-triage-daily") {
    return { name: "run_discovery_triage", args: { trigger: "cadence" } };
  }
  return isCoworkerSelfTaskId(taskId) ? coworkerSelfTaskRequiredTool(agentId) : null;
}

export function promptNamesTool(lowerPrompt: string, toolName: string): boolean {
  const name = toolName.toLowerCase();
  let from = 0;
  for (;;) {
    const at = lowerPrompt.indexOf(name, from);
    if (at < 0) return false;
    const before = at === 0 ? "" : lowerPrompt[at - 1]!;
    const after = lowerPrompt[at + name.length] ?? "";
    const boundary = (ch: string) => ch === "" || !/[a-z0-9_]/.test(ch);
    if (boundary(before) && boundary(after)) return true;
    from = at + 1;
  }
}

/** The writer every Workroom stage run records its stage evidence through. */
export const WORKROOM_STAGE_EVIDENCE_TOOL = "record_workroom_evidence";

/**
 * The governed writers a run must be OFFERED, whatever its grants say
 * (BI-62DB6C03).
 *
 * scheduledRequiredToolNames and the verdict derive "required" from the
 * AUTHORIZED set, so a run that is not offered the writer — an advise boundary
 * strips every side-effecting tool, or the grant or owner capability is
 * missing — has nothing required, is recorded ok, and the drive dispatches the
 * stage again. A Workroom stage run (taskConfig.workroomStage, or a brief naming
 * the writer) cannot do its job without the writer, so that requirement is
 * stated here independently of authority.
 */
export function scheduledMandatoryToolNames(input: { prompt: string; taskConfig?: unknown }): string[] {
  const isStageRun = readWorkroomStageTaskConfig(input.taskConfig) !== null
    || promptNamesTool(input.prompt.toLowerCase(), WORKROOM_STAGE_EVIDENCE_TOOL);
  return isStageRun ? [WORKROOM_STAGE_EVIDENCE_TOOL] : [];
}

