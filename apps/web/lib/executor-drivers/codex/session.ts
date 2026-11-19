// Codex `app-server` as a Workroom's supervised runtime (BI-05715F4C, design
// §4.7). The protocol is Codex's own JSON-RPC (checked against T3 Code's recorded
// transcripts, codex 0.156): initialize → initialized → account/login/start →
// thread/start | thread/resume → turn/start, with turn/steer and turn/interrupt
// on the turn in progress. Codex asks before it runs a command or changes files
// (item/*/requestApproval); those questions become RuntimeRequests the room
// answers, instead of being bypassed with --dangerously-bypass-approvals.
//
// The room's MCP endpoint is mounted through Codex's own config, with the
// session's bearer token read from an environment variable, never argv.

import type { CodexCatalogLogin } from "@/lib/routing/codex-cli-model-catalog";

import { createJsonRpcPeer, type JsonRpcPeer } from "@/lib/workroom-runtime/json-rpc-peer";
import type { RuntimeLauncher } from "@/lib/workroom-runtime/sandbox-launcher";
import type {
  DriverCapabilities,
  ExecutorDriver,
  RuntimeDecision,
  RuntimeEventSink,
  RuntimeRequest,
  RuntimeSession,
  RuntimeSessionConfig,
  TurnUsage,
} from "../types";

/** Runs inside the sandbox. Credentials stay in memory (ephemeral store); threads persist in CODEX_HOME. */
export const CODEX_SESSION_SCRIPT = [
  'mkdir -p "$CODEX_HOME"',
  'exec codex -c cli_auth_credentials_store="ephemeral"',
  '-c "mcp_servers.dpf.url=\\"$DPF_MCP_URL\\""',
  '-c "mcp_servers.dpf.bearer_token_env_var=\\"DPF_MCP_TOKEN\\""',
  "app-server --stdio",
].join(" ");

const APPROVAL_METHODS: Record<string, RuntimeRequest["kind"]> = {
  "item/commandExecution/requestApproval": "command",
  "item/fileChange/requestApproval": "file-change",
  "item/permissions/requestApproval": "permission",
};

type PendingRequest = { rpcId: string | number; method: string; params: Record<string, unknown> };

/** Codex runs one-shot as `codex exec` (exec.ts) and as a session over app-server. */
export const CODEX_CAPABILITIES: DriverCapabilities = {
  steer: true, interrupt: true, runtimeRequests: "session", resumeThread: true, usage: true, oneShot: true,
};

type TokenCounts = { input: number; cached: number; output: number };

function tokenCounts(value: unknown): TokenCounts | null {
  const v = value as { inputTokens?: unknown; cachedInputTokens?: unknown; outputTokens?: unknown } | undefined;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null);
  const input = n(v?.inputTokens), cached = n(v?.cachedInputTokens), output = n(v?.outputTokens);
  return input === null || cached === null || output === null ? null : { input, cached, output };
}

/**
 * Per-turn usage from `thread/tokenUsage/updated` (as T3 Code reads it). `total`
 * is thread-wide, so a turn costs the growth of `total` while it is active; a
 * total that went backwards (a resumed or compacted thread) falls back to
 * `last`, the newest single response. Totals seen between turns move the
 * baseline only.
 */
function createUsageMeter() {
  let baseline: TokenCounts | null = null;
  const turns = new Map<string, TokenCounts>();
  return {
    observe(turnId: string | null, activeTurnId: string | null, tokenUsage: Record<string, unknown> | undefined) {
      const total = tokenCounts(tokenUsage?.["total"]);
      if (!total) return;
      const previous = baseline;
      baseline = total;
      if (!turnId || turnId !== activeTurnId) return;
      const grew = previous && total.input >= previous.input && total.cached >= previous.cached && total.output >= previous.output;
      const delta = grew
        ? { input: total.input - previous.input, cached: total.cached - previous.cached, output: total.output - previous.output }
        : tokenCounts(tokenUsage?.["last"]);
      if (!delta) return;
      const sum = turns.get(turnId) ?? { input: 0, cached: 0, output: 0 };
      turns.set(turnId, { input: sum.input + delta.input, cached: sum.cached + delta.cached, output: sum.output + delta.output });
    },
    /** Codex counts cached input inside input; DPF reports it apart, as Claude does. */
    settle(turnId: string): TurnUsage {
      const sum = turns.get(turnId);
      turns.delete(turnId);
      if (!sum || sum.input + sum.output === 0) return { reported: "unknown" };
      return { reported: "native", inputTokens: Math.max(0, sum.input - sum.cached), cacheReadInputTokens: sum.cached, outputTokens: sum.output };
    },
  };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function turnIdOf(params: Record<string, unknown>): string | null {
  const turn = params["turn"] as { id?: unknown } | undefined;
  return text(turn?.id) ?? text(params["turnId"]);
}

/** The answer Codex expects for each kind of question. */
export function codexApprovalResponse(method: string, params: Record<string, unknown>, decision: RuntimeDecision): unknown {
  if (method === "item/permissions/requestApproval") {
    return decision === "accept" ? { permissions: params["permissions"] ?? {}, scope: "turn" } : { permissions: {}, scope: "turn" };
  }
  return { decision };
}

export function createCodexSessionDriver(deps: {
  launch: RuntimeLauncher;
  login: () => Promise<CodexCatalogLogin>;
}): ExecutorDriver {
  return {
    provider: "codex",
    capabilities: CODEX_CAPABILITIES,
    async openSession(config: RuntimeSessionConfig, onEvent: RuntimeEventSink): Promise<RuntimeSession> {
      const login = await deps.login();
      const proc = deps.launch({
        script: CODEX_SESSION_SCRIPT,
        cwd: config.cwd,
        env: { DPF_MCP_URL: config.mcp.url, DPF_MCP_TOKEN: config.mcp.bearerToken, CODEX_HOME: `${config.cwd}/.dpf-runtime/${config.capsuleId}/codex-home` },
      });
      proc.onStderr(() => {}); // Drained, never surfaced: it can carry provider detail.
      let threadId: string | null = config.resumeThreadId ?? null;
      let activeTurnId: string | null = null;
      // Keep settlement for the session lifetime: acknowledgements and replayed
      // notifications can arrive after more than one later turn has finished.
      const settledTurnIds = new Set<string>();
      const pending = new Map<string, PendingRequest>();
      const usage = createUsageMeter();

      const peer: JsonRpcPeer = createJsonRpcPeer(proc, {
        onNotification(method, params) {
          // A process may report child-thread activity. Only this room's root
          // thread and turn can drive its supervisor's next queued input.
          if (!threadId || text(params["threadId"]) !== threadId) return;
          const turnId = turnIdOf(params);
          if (method === "thread/tokenUsage/updated") {
            usage.observe(turnId, activeTurnId, params["tokenUsage"] as Record<string, unknown> | undefined);
            return;
          }
          if (!turnId) return;
          if (method === "turn/started") {
            if (settledTurnIds.has(turnId) || (activeTurnId && activeTurnId !== turnId)) return;
            activeTurnId = turnId;
            onEvent({ type: "turn-started", turnId });
          } else if (method === "item/completed") {
            if (turnId !== activeTurnId) return;
            const item = params["item"] as { type?: unknown; text?: unknown } | undefined;
            const said = item?.type === "agentMessage" ? text(item.text) : null;
            if (said) onEvent({ type: "message", turnId, text: said });
          } else if (method === "turn/completed") {
            if (turnId !== activeTurnId) return;
            const turn = params["turn"] as { status?: unknown; error?: { message?: unknown } | null };
            const status = turn?.status;
            if (status !== "completed" && status !== "interrupted" && status !== "failed") return;
            activeTurnId = null;
            settledTurnIds.add(turnId);
            // Usage is reported before the turn is closed, so it belongs to that turn.
            onEvent({ type: "usage", turnId, usage: usage.settle(turnId) });
            onEvent({ type: "turn-completed", turnId, status, error: text(turn.error?.message) });
          }
        },
        onServerRequest(rpcId, method, params) {
          const kind = APPROVAL_METHODS[method];
          if (!kind) {
            peer.respondError(rpcId, -32601, `DPF does not answer ${method}`);
            return;
          }
          const requestId = String(text(params["approvalId"]) ?? text(params["itemId"]) ?? rpcId);
          pending.set(requestId, { rpcId, method, params });
          const summary = text(params["command"]) ?? text(params["reason"])
            ?? (kind === "file-change" ? "change files in the workspace" : "widen its access");
          onEvent({ type: "runtime-request", request: { requestId, kind, turnId: text(params["turnId"]), summary, detail: params } });
        },
        onClose(code) {
          onEvent({ type: "session-exited", code, reason: code === 0 ? "the runtime exited" : `the runtime exited with ${code ?? "a signal"}` });
        },
      });

      try {
        await peer.request("initialize", { clientInfo: { name: "dpf-workroom-runtime", version: "1.0.0" }, capabilities: { experimentalApi: true } });
        peer.notify("initialized");
        await peer.request("account/login/start", login as unknown as Record<string, unknown>);
      } catch (error) {
        peer.close();
        proc.kill();
        throw error;
      }

      const requireThread = () => {
        if (!threadId) throw new Error("No Codex thread is open for this session.");
        return threadId;
      };

      const session: RuntimeSession = {
        provider: "codex",
        threadId: () => threadId,
        activeTurnId: () => activeTurnId,
        async ensureThread() {
          const result = threadId
            ? await peer.request<{ thread?: { id?: string } }>("thread/resume", { threadId, excludeTurns: true })
            : await peer.request<{ thread?: { id?: string } }>("thread/start", { cwd: config.cwd, ...(config.model ? { model: config.model } : {}) });
          const id = text(result?.thread?.id);
          if (!id) throw new Error("Codex did not return a thread id.");
          threadId = id;
          return id;
        },
        async startTurn(input) {
          const result = await peer.request<{ turn?: { id?: string } }>("turn/start", {
            threadId: requireThread(),
            input: [{ type: "text", text: input }],
            cwd: config.cwd,
            // Codex asks; the room answers (runtime-request-policy). Writes stay in the workspace.
            approvalPolicy: "on-request",
            sandboxPolicy: { type: "workspaceWrite" },
            ...(config.model ? { model: config.model } : {}),
          });
          // A fast turn can finish before the start request is acknowledged.
          const startedTurnId = text(result?.turn?.id);
          if (startedTurnId && !settledTurnIds.has(startedTurnId)) activeTurnId = startedTurnId;
          return { turnId: activeTurnId };
        },
        async steerTurn(input) {
          if (!activeTurnId) return false;
          await peer.request("turn/steer", { threadId: requireThread(), expectedTurnId: activeTurnId, input: [{ type: "text", text: input }] });
          return true;
        },
        async interruptTurn() {
          if (!activeTurnId) return;
          await peer.request("turn/interrupt", { threadId: requireThread(), turnId: activeTurnId });
        },
        async respondToRuntimeRequest(requestId, decision) {
          const request = pending.get(requestId);
          if (!request) throw new Error(`No open runtime request ${requestId}.`);
          pending.delete(requestId);
          peer.respond(request.rpcId, codexApprovalResponse(request.method, request.params, decision));
        },
        async close() {
          for (const [requestId] of pending) await session.respondToRuntimeRequest(requestId, "cancel").catch(() => {});
          peer.close();
          proc.kill();
        },
      };
      return session;
    },
  };
}
