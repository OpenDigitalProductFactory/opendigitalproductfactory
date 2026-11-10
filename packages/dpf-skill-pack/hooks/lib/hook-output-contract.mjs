// packages/dpf-skill-pack/hooks/lib/hook-output-contract.mjs
//
// What each client accepts as hook output, per event (BI-5DD46FDA).
//
// A client that rejects a hook's output does not say so to the agent: Claude
// logs a non-blocking error and runs the tool; Codex marks the hook run failed
// and continues. Between 2026-10-07 and 10-14 the workroom-claim guard emitted a
// top-level `"decision":"deny"` and Claude ignored its block 477 times. The
// exhaustive walk (hook-output-contract.test.mjs) and the SessionStart self-test
// run every hook against these rules, so a hook the client would ignore is
// caught before it ships and again on the installed copy.
//
// Sources, read 2026-10-28:
//   claude-code : https://code.claude.com/docs/en/hooks (JSON output, decision control)
//   codex       : https://learn.chatgpt.com/docs/hooks (formerly developers.openai.com/codex/hooks)
//   grok        : no published schema; the live-probed envelope (BI-883FC2FC,
//                 BI-742D707B, Grok 1.0.52): a deny travels in a top-level
//                 `decision: "deny"` with `reason`, and nothing else steers it.

export const CONTRACT_CLIENTS = ["claude-code", "codex", "grok"];

const COMMON_FIELDS = {
  continue: "boolean",
  stopReason: "string",
  suppressOutput: "boolean",
  systemMessage: "string",
  decision: "string",
  reason: "string",
  hookSpecificOutput: "object",
};

// Claude: the top-level decision values each event accepts. PreToolUse keeps the
// legacy approve|block; an event with no decision control accepts none.
const CLAUDE_DECISIONS = {
  PreToolUse: ["approve", "block"],
  PostToolUse: ["block"],
  Stop: ["block"],
  SubagentStop: ["block"],
  UserPromptSubmit: ["block"],
};

// Claude: hookSpecificOutput fields per event.
const CLAUDE_SPECIFIC = {
  PreToolUse: ["permissionDecision", "permissionDecisionReason", "updatedInput", "additionalContext"],
  PostToolUse: ["additionalContext", "updatedToolOutput", "updatedMCPToolOutput", "classifierContext"],
  SessionStart: ["additionalContext", "initialUserMessage", "sessionTitle", "watchPaths", "reloadSkills"],
  Stop: ["additionalContext"],
  SubagentStop: ["additionalContext"],
  UserPromptSubmit: ["additionalContext"],
};

const CODEX_DECISIONS = { PreToolUse: ["block"], PostToolUse: ["block"], Stop: ["block"], SubagentStop: ["block"], UserPromptSubmit: ["block"] };
const CODEX_SPECIFIC = {
  PreToolUse: ["permissionDecision", "permissionDecisionReason", "updatedInput", "additionalContext"],
  PostToolUse: ["additionalContext"],
  SessionStart: ["additionalContext"],
  UserPromptSubmit: ["additionalContext"],
};
// Codex: "parsed but not supported yet" — the hook run fails and the tool runs.
const CODEX_UNSUPPORTED = {
  PreToolUse: ["stopReason", "suppressOutput"],
  PostToolUse: ["suppressOutput"],
};

const SHELL_TOOLS = new Set(["Bash", "Shell", "run_terminal_command", "run_terminal_cmd"]);

function parse(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return { empty: true };
  if (!/^[{[]/.test(text)) return { text };
  try {
    return { json: JSON.parse(text) };
  } catch {
    return { invalid: "output starts like JSON but does not parse, so the client discards it" };
  }
}

function typeProblems(out) {
  const problems = [];
  for (const [key, value] of Object.entries(out)) {
    const want = COMMON_FIELDS[key];
    if (!want) problems.push(`top-level "${key}" is not a hook output field`);
    else if (want === "object" ? !value || typeof value !== "object" || Array.isArray(value) : typeof value !== want) {
      problems.push(`top-level "${key}" must be a ${want}`);
    }
  }
  return problems;
}

function updatedInputProblems(specific, toolName) {
  if (!("updatedInput" in specific)) return [];
  const input = specific.updatedInput;
  if (!input || typeof input !== "object" || Array.isArray(input)) return ["hookSpecificOutput.updatedInput must be an object"];
  if (SHELL_TOOLS.has(toolName) && typeof input.command !== "string") return ["a shell updatedInput must carry a string command"];
  return [];
}

function claudeProblems(event, out, toolName) {
  const problems = typeProblems(out);
  if ("decision" in out && !(CLAUDE_DECISIONS[event] ?? []).includes(out.decision)) {
    const allowed = CLAUDE_DECISIONS[event] ?? [];
    problems.push(
      `top-level decision "${out.decision}" fails Claude's ${event} output validation (${allowed.length ? allowed.join("|") : "no decision field"}), so Claude discards the whole output`,
    );
  }
  const specific = out.hookSpecificOutput;
  if (specific && typeof specific === "object") {
    if (specific.hookEventName !== event) problems.push(`hookSpecificOutput.hookEventName is "${specific.hookEventName}", not "${event}"`);
    const fields = CLAUDE_SPECIFIC[event] ?? [];
    for (const key of Object.keys(specific)) {
      if (key !== "hookEventName" && !fields.includes(key)) problems.push(`hookSpecificOutput.${key} is not a ${event} field`);
    }
    if (event === "PreToolUse") {
      if ("permissionDecision" in specific && !["allow", "deny", "ask", "defer"].includes(specific.permissionDecision)) {
        problems.push(`permissionDecision "${specific.permissionDecision}" is not allow|deny|ask|defer`);
      }
      if ("updatedInput" in specific && !["allow", "ask"].includes(specific.permissionDecision)) {
        problems.push("updatedInput without permissionDecision allow|ask does not run the rewritten input");
      }
      problems.push(...updatedInputProblems(specific, toolName));
    }
  }
  return problems;
}

function codexProblems(event, out, toolName) {
  const problems = typeProblems(out);
  if ("decision" in out && !(CODEX_DECISIONS[event] ?? []).includes(out.decision)) {
    problems.push(`top-level decision "${out.decision}" is not one Codex supports for ${event}, so the hook run fails and the tool runs`);
  }
  if (out.continue === false && event === "PreToolUse") problems.push("continue:false is parsed but not supported on PreToolUse, so Codex fails open");
  for (const key of CODEX_UNSUPPORTED[event] ?? []) {
    if (key in out) problems.push(`top-level "${key}" is parsed but not supported on ${event}, so Codex fails the hook run`);
  }
  const specific = out.hookSpecificOutput;
  if (specific && typeof specific === "object") {
    if (specific.hookEventName !== event) problems.push(`hookSpecificOutput.hookEventName is "${specific.hookEventName}", not "${event}"`);
    const fields = CODEX_SPECIFIC[event] ?? [];
    for (const key of Object.keys(specific)) {
      if (key !== "hookEventName" && !fields.includes(key)) problems.push(`hookSpecificOutput.${key} is not a Codex ${event} field`);
    }
    if (event === "PreToolUse") {
      if ("permissionDecision" in specific && !["allow", "deny"].includes(specific.permissionDecision)) {
        problems.push(`permissionDecision "${specific.permissionDecision}" is parsed but not supported, so Codex fails open`);
      }
      if ("updatedInput" in specific && specific.permissionDecision !== "allow") problems.push("Codex applies updatedInput only with permissionDecision allow");
      problems.push(...updatedInputProblems(specific, toolName));
    }
  }
  return problems;
}

function grokProblems(event, out) {
  const problems = [];
  if (event !== "PreToolUse") return problems;
  const specific = out.hookSpecificOutput && typeof out.hookSpecificOutput === "object" ? out.hookSpecificOutput : {};
  const meansDeny = specific.permissionDecision === "deny" || out.decision === "block" || out.decision === "deny";
  if (meansDeny && (out.decision !== "deny" || typeof out.reason !== "string" || !out.reason)) {
    problems.push('a deny without top-level decision "deny" and a reason is ignored by Grok, so the tool runs');
  }
  if ("decision" in out && out.decision !== "deny") problems.push(`top-level decision "${out.decision}" is not the probed Grok verdict ("deny")`);
  if ("updatedInput" in specific) problems.push("Grok has no proven rewrite channel, so it would run the raw input");
  if (specific.permissionDecision === "ask") problems.push("Grok has no proven ask channel");
  return problems;
}

/**
 * Every reason `stdout` (exit 0) breaks the client's hook-output contract for `event`.
 * @param {{ client: "claude-code"|"codex"|"grok", event: string, stdout: string, toolName?: string }} args
 * @returns {string[]}
 */
export function hookOutputProblems({ client, event, stdout, toolName }) {
  const parsed = parse(stdout);
  if (event === "WorktreeCreate") {
    // Claude reads a command hook's stdout as the worktree path; JSON there is a path that does not exist.
    const text = String(stdout ?? "").trim();
    if (!text) return ["WorktreeCreate printed no path, so worktree creation fails"];
    if (parsed.json || parsed.invalid || text.includes("\n") || !(/^[a-zA-Z]:[\\/]/.test(text) || text.startsWith("/"))) {
      return [`WorktreeCreate stdout must be one absolute path, got ${JSON.stringify(text.slice(0, 80))}`];
    }
    return [];
  }
  if (parsed.empty) return [];
  if (parsed.invalid) return [parsed.invalid];
  if (parsed.text !== undefined) {
    if (client === "codex" && (event === "Stop" || event === "SubagentStop")) return [`plain text is invalid Codex ${event} output`];
    return [];
  }
  const out = parsed.json;
  if (!out || typeof out !== "object" || Array.isArray(out)) return ["output is JSON but not an object"];
  if (client === "claude-code") return claudeProblems(event, out, toolName);
  if (client === "codex") return codexProblems(event, out, toolName);
  if (client === "grok") return grokProblems(event, out);
  return [`no output contract is recorded for client "${client}"`];
}
