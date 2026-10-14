// The executor adapter contract: one shape over every agent CLI a Workroom can
// drive as a supervised runtime (BI-05715F4C, design
// 2026-10-07-durable-delegation-ledger-design.md §4.7). Adopted from T3 Code's
// Orchestration V2 ProviderAdapter (openSession → ensureThread / resumeThread /
// startTurn / steerTurn / interruptTurn / respondToRuntimeRequest); DPF owns the
// session and the room, and provider ids are only references.

export type RuntimeProvider = "codex" | "claude";

/** A question the CLI asks before it acts: run a command, change files, widen access. */
export type RuntimeRequest = {
  /** The provider's id for the request; the answer must carry it back. */
  requestId: string;
  kind: "command" | "file-change" | "permission" | "tool";
  turnId: string | null;
  /** What the CLI wants to do, as it described it (command line, tool name, paths). */
  summary: string;
  detail: Record<string, unknown>;
};

export type RuntimeDecision = "accept" | "decline" | "cancel";

/** What a session reports. The supervisor writes each one to the room's log. */
export type RuntimeEvent =
  | { type: "turn-started"; turnId: string }
  | { type: "message"; turnId: string | null; text: string }
  | { type: "turn-completed"; turnId: string; status: "completed" | "interrupted" | "failed"; error?: string | null }
  | { type: "runtime-request"; request: RuntimeRequest }
  | { type: "session-exited"; code: number | null; reason: string };

export type RuntimeSessionConfig = {
  capsuleId: string;
  /** The room's MCP endpoint and the session's own room-scoped bearer token. */
  mcp: { url: string; bearerToken: string };
  /** Working directory inside the sandbox. */
  cwd: string;
  model?: string | null;
  /** Provider thread to resume, from the room's stored session. */
  resumeThreadId?: string | null;
};

export type RuntimeSession = {
  provider: RuntimeProvider;
  /** The provider's thread (Codex thread id, Claude session id) once known. */
  threadId(): string | null;
  /** The turn in progress, if any. */
  activeTurnId(): string | null;
  /** Make sure the provider thread exists: resume the stored one, or start one. */
  ensureThread(): Promise<string>;
  startTurn(input: string): Promise<{ turnId: string | null }>;
  /** Add input to the turn in progress. False when the provider cannot steer. */
  steerTurn(input: string): Promise<boolean>;
  interruptTurn(): Promise<void>;
  respondToRuntimeRequest(requestId: string, decision: RuntimeDecision): Promise<void>;
  close(): Promise<void>;
};

export type RuntimeEventSink = (event: RuntimeEvent) => void;

export type ExecutorAdapter = {
  provider: RuntimeProvider;
  /** Steering a running turn is native to the provider (not a new turn). */
  supportsSteer: boolean;
  openSession(config: RuntimeSessionConfig, onEvent: RuntimeEventSink): Promise<RuntimeSession>;
};
