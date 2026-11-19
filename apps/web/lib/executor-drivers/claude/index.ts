// The Claude driver (BI-A01B06F6): Claude Code over its CLI, with no
// proprietary SDK. The session face (stream-json) serves the Workroom runtime;
// the one-shot face (`-p`, json) serves Build Studio dispatch, Ideate and
// inference routing. All of them resolve auth through the same function.

import { sandboxRuntimeLauncher, type RuntimeLauncher } from "@/lib/workroom-runtime/sandbox-launcher";
import type { ExecutorDriver } from "../types";
import { resolveClaudeAuth, type ClaudeAuth } from "./auth";
import { createClaudeSessionDriver } from "./session";

export { claudeCredential, resolveClaudeAuth, type ClaudeAuth, type ClaudeConnection } from "./auth";
export { CLAUDE_CODE_NATIVE_TOOLS_FLAG_VALUE, claudeOneShotArgs, parseClaudeResult, type ClaudeOneShotResult } from "./one-shot";
export { CLAUDE_CAPABILITIES, CLAUDE_SESSION_SCRIPT, RUNTIME_PERMISSION_TOOL, claudeSessionFlags } from "./session";

export function createClaudeDriver(deps: { launch: RuntimeLauncher; auth: () => Promise<ClaudeAuth> }): ExecutorDriver {
  return createClaudeSessionDriver(deps);
}

/** The Claude driver on the sandbox, using the subscription account. */
export const claudeDriver: ExecutorDriver = createClaudeDriver({
  launch: sandboxRuntimeLauncher,
  auth: () => resolveClaudeAuth("anthropic-sub"),
});
