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

import { createJsonRpcPeer, type JsonRpcPeer } from "./json-rpc-peer";
import type { RuntimeLauncher } from "./sandbox-launcher";
import type {
  ExecutorAdapter,
  RuntimeDecision,
  RuntimeEventSink,
  RuntimeRequest,
  RuntimeSession,
  RuntimeSessionConfig,
} from "./types";

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

export function createCodexAdapter(deps: {
  launch: RuntimeLauncher;
  login: () => Promise<CodexCatalogLogin>;
}): ExecutorAdapter {
  return {
    provider: "codex",
    supportsSteer: true,
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
      const pending = new Map<string, PendingRequest>();

      const peer: JsonRpcPeer = createJsonRpcPeer(proc, {
        onNotification(method, params) {
          if (method === "turn/started") {
            activeTurnId = turnIdOf(params);
            if (activeTurnId) onEvent({ type: "turn-started", turnId: activeTurnId });
          } else if (method === "item/completed") {
            const item = params["item"] as { type?: unknown; text?: unknown } | undefined;
            const said = item?.type === "agentMessage" ? text(item.text) : null;
            if (said) onEvent({ type: "message", turnId: text(params["turnId"]), text: said });
          } else if (method === "turn/completed") {
            const turn = (params["turn"] ?? {}) as { id?: unknown; status?: unknown; error?: { message?: unknown } | null };
            const turnId = text(turn.id) ?? activeTurnId ?? "unknown";
            if (activeTurnId === turnId) activeTurnId = null;
            const status = turn.status === "interrupted" ? "interrupted" : turn.status === "failed" ? "failed" : "completed";
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
          activeTurnId = text(result?.turn?.id) ?? activeTurnId;
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
