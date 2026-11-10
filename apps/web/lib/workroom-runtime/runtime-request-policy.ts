// How a Workroom answers its agent CLI's questions (BI-05715F4C, design §4.7:
// "CLI approval prompts become room decision requests under existing
// escalation doctrine").
//
// Doctrine (escalation-is-a-gate-not-a-trust-tier): a human is engaged only
// when the action is damaging or nothing recorded can steer it. Inside the
// sandbox the workspace is the boundary, so reading, editing and running local
// commands there is the work itself and is accepted. Anything that reaches past
// the sandbox (publishing, pushing, network fetches, credentials, widening the
// sandbox's own access) is escalated: recorded on the room as a decision
// request and held until someone with authority on the room answers.

export type RuntimeRequestVerdict =
  | { verdict: "accept"; reason: string }
  | { verdict: "escalate"; reason: string };

/** Commands that act outside the sandbox or on shared state. Matched as words, anywhere in the line. */
const OUTWARD_COMMANDS: ReadonlyArray<[RegExp, string]> = [
  [/\bgit\s+push\b/, "pushes to a remote"],
  [/\bgh\s+(?:pr|release|repo|api|issue|workflow)\b/, "acts on GitHub"],
  [/\b(?:npm|pnpm|yarn)\s+publish\b/, "publishes a package"],
  [/\b(?:curl|wget)\b/, "fetches from the network"],
  [/\b(?:ssh|scp|rsync|sftp)\b/, "reaches another host"],
  [/\b(?:docker|kubectl|helm|terraform)\b/, "drives shared infrastructure"],
  [/\b(?:aws|gcloud|az)\s+\w/, "calls a cloud control plane"],
  [/\brm\s+-[a-z]*r[a-z]*f?\s+\/(?:\s|$)/, "deletes from the filesystem root"],
  [/\b(?:printenv|env)\b.*\b(?:TOKEN|KEY|SECRET)\b/i, "reads credentials"],
];

/** Claude Code tools that leave the sandbox. */
const OUTWARD_TOOLS = new Set(["WebFetch", "WebSearch"]);
/** Claude Code tools that only read or edit inside the workspace. */
const WORKSPACE_TOOLS = new Set(["Read", "Glob", "Grep", "LS", "Edit", "MultiEdit", "Write", "NotebookEdit", "TodoWrite", "Task"]);

function outwardCommand(command: string): string | null {
  for (const [pattern, why] of OUTWARD_COMMANDS) if (pattern.test(command)) return why;
  return null;
}

function insideWorkspace(path: unknown, cwd: string): boolean {
  if (typeof path !== "string" || !path) return true;
  if (!path.startsWith("/")) return !path.split("/").includes("..");
  return (path === cwd || path.startsWith(`${cwd}/`)) && !path.split("/").includes("..");
}

/** A Codex question (command, file change, permission widening). */
export function decideCodexRequest(input: {
  kind: "command" | "file-change" | "permission" | "tool";
  summary: string;
  detail: Record<string, unknown>;
}): RuntimeRequestVerdict {
  if (input.kind === "permission") return { verdict: "escalate", reason: "it asks to widen the sandbox's access" };
  if (input.kind === "command") {
    const why = outwardCommand(input.summary);
    return why ? { verdict: "escalate", reason: `the command ${why}` } : { verdict: "accept", reason: "a command inside the sandbox workspace" };
  }
  return { verdict: "accept", reason: "a change inside the sandbox workspace" };
}

/** A Claude Code tool call, asked through --permission-prompt-tool. */
export function decideClaudeToolCall(input: { toolName: string; input: Record<string, unknown>; cwd: string }): RuntimeRequestVerdict {
  const { toolName } = input;
  // DPF's own tools are governed by DPF on the room's scoped credential.
  if (toolName.startsWith("mcp__dpf__")) return { verdict: "accept", reason: "a DPF tool, governed on the room's credential" };
  if (toolName.startsWith("mcp__")) return { verdict: "escalate", reason: `${toolName} is an MCP server outside DPF` };
  if (OUTWARD_TOOLS.has(toolName)) return { verdict: "escalate", reason: `${toolName} reaches outside the sandbox` };
  if (toolName === "Bash") {
    const why = outwardCommand(String(input.input["command"] ?? ""));
    return why ? { verdict: "escalate", reason: `the command ${why}` } : { verdict: "accept", reason: "a command inside the sandbox workspace" };
  }
  if (WORKSPACE_TOOLS.has(toolName)) {
    const path = input.input["file_path"] ?? input.input["path"] ?? input.input["notebook_path"];
    return insideWorkspace(path, input.cwd)
      ? { verdict: "accept", reason: "reads or edits inside the workspace" }
      : { verdict: "escalate", reason: `it touches ${String(path)}, outside the workspace` };
  }
  return { verdict: "escalate", reason: `${toolName} is not a tool the room has a rule for` };
}
