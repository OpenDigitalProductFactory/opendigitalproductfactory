import { randomUUID } from "crypto";

export type AutonomousWorkTrigger =
  | "interactive"
  | "scheduled"
  | "external-mcp"
  | "build"
  | "deliberation"
  | "radar"
  | "system-recovery"
  | "capacity-continuity";

const TRIGGER_PREFIX: Record<AutonomousWorkTrigger, string> = {
  interactive: "CHAT",
  scheduled: "SCHED",
  "external-mcp": "MCP",
  build: "BUILD",
  deliberation: "DELIB",
  radar: "RADAR",
  "system-recovery": "RECOV",
  "capacity-continuity": "CAP",
};

export function taskRunSourceForTrigger(trigger: AutonomousWorkTrigger): string {
  if (trigger === "interactive") return "coworker";
  if (trigger === "build") return "build";
  if (trigger === "deliberation") return "skill";
  return "proactive";
}

export function initialStatusForTrigger(trigger: AutonomousWorkTrigger): string {
  return trigger === "interactive" ? "submitted" : "working";
}

export function createPublicTaskRunId(trigger: AutonomousWorkTrigger): string {
  return `TR-${TRIGGER_PREFIX[trigger]}-${randomUUID().slice(0, 8).toUpperCase()}`;
}
