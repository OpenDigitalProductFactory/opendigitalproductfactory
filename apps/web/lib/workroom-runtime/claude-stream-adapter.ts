// Claude Code as a Workroom's supervised runtime (BI-05715F4C, design §4.7).
//
// One long-lived `claude -p` in stream-json mode: each turn is a user message
// written to stdin, the session's events come back on stdout, and the process
// keeps the conversation between turns. This is the transport the Claude Agent
// SDK itself drives, without adding the SDK as a dependency. Its approval
// prompts go to DPF through `--permission-prompt-tool`: the CLI asks the room's
// MCP tool approve_runtime_permission before it acts, so nothing runs with
// --dangerously-skip-permissions.

import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";

import type { RuntimeLauncher } from "./sandbox-launcher";
import type { ExecutorAdapter, RuntimeEventSink, RuntimeSession, RuntimeSessionConfig } from "./types";

export const RUNTIME_PERMISSION_TOOL = "approve_runtime_permission";

export type ClaudeRuntimeAuth = { mode: "oauth"; token: string } | { mode: "apikey"; apiKey: string };

/** Runs inside the sandbox. The MCP config (with the bearer) is written 0600 and never on argv. */
export const CLAUDE_SESSION_SCRIPT = [
  'umask 077 && mkdir -p "$DPF_RUNTIME_DIR"',
  'printf "%s" "$DPF_MCP_CONFIG" > "$DPF_RUNTIME_DIR/mcp.json" && unset DPF_MCP_CONFIG',
  `exec claude -p --input-format stream-json --output-format stream-json --verbose`
    + ` --mcp-config "$DPF_RUNTIME_DIR/mcp.json" --strict-mcp-config`
    + ` --permission-prompt-tool mcp__dpf__${RUNTIME_PERMISSION_TOOL}`
    + ` $DPF_SESSION_FLAGS`,
].join("; ");

const SESSION_ID = /^[0-9a-f-]{8,64}$/i;
const MODEL = /^[A-Za-z0-9._:-]{1,80}$/;

export function claudeSessionFlags(config: RuntimeSessionConfig, sessionId: string): string {
  const resume = config.resumeThreadId && SESSION_ID.test(config.resumeThreadId) ? config.resumeThreadId : null;
  const model = config.model && MODEL.test(config.model) ? config.model : null;
  return [resume ? `--resume ${resume}` : `--session-id ${sessionId}`, model ? `--model ${model}` : ""].filter(Boolean).join(" ");
}

export function createClaudeAdapter(deps: {
  launch: RuntimeLauncher;
  auth: () => Promise<ClaudeRuntimeAuth>;
}): ExecutorAdapter {
  return {
    provider: "claude",
    // A message sent mid-turn waits for the turn to end, so it is a new turn, not a steer.
    supportsSteer: false,
    async openSession(config: RuntimeSessionConfig, onEvent: RuntimeEventSink): Promise<RuntimeSession> {
      const auth = await deps.auth();
      const sessionId = config.resumeThreadId && SESSION_ID.test(config.resumeThreadId) ? config.resumeThreadId : randomUUID();
      const mcpConfig = { mcpServers: { dpf: { type: "http", url: config.mcp.url, headers: { Authorization: `Bearer ${config.mcp.bearerToken}` } } } };
      const proc = deps.launch({
        script: CLAUDE_SESSION_SCRIPT,
        cwd: config.cwd,
        env: {
          DPF_RUNTIME_DIR: `${config.cwd}/.dpf-runtime/${config.capsuleId}`,
          DPF_MCP_CONFIG: JSON.stringify(mcpConfig),
          DPF_SESSION_FLAGS: claudeSessionFlags(config, sessionId),
          ...(auth.mode === "oauth" ? { CLAUDE_CODE_OAUTH_TOKEN: auth.token } : { ANTHROPIC_API_KEY: auth.apiKey }),
        },
      });
      proc.onStderr(() => {});
      let threadId: string = sessionId;
      let activeTurnId: string | null = null;
      let turns = 0;
      let buffer = "";
      let closed = false;
      const decoder = new StringDecoder("utf8");

      const handle = (event: Record<string, unknown>) => {
        if (event["type"] === "system" && event["subtype"] === "init" && typeof event["session_id"] === "string") {
          threadId = event["session_id"];
        } else if (event["type"] === "assistant") {
          const content = ((event["message"] as { content?: unknown })?.content ?? []) as Array<{ type?: string; text?: string }>;
          const said = content.filter((part) => part.type === "text" && part.text?.trim()).map((part) => part.text).join("\n");
          if (said) onEvent({ type: "message", turnId: activeTurnId, text: said });
        } else if (event["type"] === "result") {
          const turnId = activeTurnId ?? `turn-${turns}`;
          activeTurnId = null;
          const failed = event["is_error"] === true || (typeof event["subtype"] === "string" && event["subtype"] !== "success");
          onEvent({ type: "turn-completed", turnId, status: failed ? "failed" : "completed",
            error: failed ? String(event["result"] ?? event["subtype"] ?? "the turn failed").slice(0, 500) : null });
        }
      };
      proc.onData((chunk) => {
        buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try { handle(JSON.parse(line) as Record<string, unknown>); } catch { /* not an event line */ }
        }
      });
      proc.onClose((code) => {
        closed = true;
        onEvent({ type: "session-exited", code, reason: code === 0 ? "the runtime exited" : `the runtime exited with ${code ?? "a signal"}` });
      });
      const write = (frame: Record<string, unknown>) => {
        if (closed) throw new Error("The Claude runtime is not running.");
        proc.write(`${JSON.stringify(frame)}\n`);
      };

      return {
        provider: "claude",
        threadId: () => threadId,
        activeTurnId: () => activeTurnId,
        async ensureThread() {
          return threadId;
        },
        async startTurn(input) {
          turns += 1;
          activeTurnId = `turn-${turns}`;
          write({ type: "user", message: { role: "user", content: [{ type: "text", text: input }] } });
          onEvent({ type: "turn-started", turnId: activeTurnId });
          return { turnId: activeTurnId };
        },
        async steerTurn() {
          return false;
        },
        async interruptTurn() {
          if (!activeTurnId) return;
          write({ type: "control_request", request_id: randomUUID(), request: { subtype: "interrupt" } });
        },
        async respondToRuntimeRequest() {
          throw new Error(`Claude asks through ${RUNTIME_PERMISSION_TOOL}; its answer is given there.`);
        },
        async close() {
          if (closed) return;
          proc.end();
          proc.kill();
        },
      };
    },
  };
}
