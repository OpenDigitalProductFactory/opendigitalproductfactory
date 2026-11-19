// The executor driver contract (BI-A01B06F6, S3): one driver per coding client,
// called by the Workroom runtime, Build Studio dispatch and inference routing.
// The session face was adopted from T3 Code's Orchestration V2 ProviderAdapter
// (openSession → ensureThread / resumeThread / startTurn / steerTurn /
// interruptTurn / respondToRuntimeRequest) for the Workroom runtime
// (BI-05715F4C); DPF owns the session and the room, and provider ids are only
// references. Plan: docs/superpowers/plans/2026-11-17-executor-drivers-and-instances.md.

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

/** The account routing selected, when it named one; otherwise the provider's default credential. */
export type AccountConnection = { connectionId: string; expectedExecutionVersion?: string };

/**
 * What one turn cost, as the client reported it. `reported: "unknown"` means
 * the client said nothing; the token fields are then absent, never zero.
 */
export type TurnUsage =
  | {
      reported: "native";
      inputTokens: number;
      outputTokens: number;
      cacheCreationInputTokens?: number;
      cacheReadInputTokens?: number;
      costUsd?: number;
    }
  | { reported: "unknown" };

/** What a session reports. The supervisor writes each one to the room's log. */
export type RuntimeEvent =
  | { type: "turn-started"; turnId: string }
  | { type: "message"; turnId: string | null; text: string }
  | { type: "turn-completed"; turnId: string; status: "completed" | "interrupted" | "failed"; error?: string | null }
  | { type: "runtime-request"; request: RuntimeRequest }
  | { type: "usage"; turnId: string | null; usage: TurnUsage }
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

/**
 * What a driver can do, stated by the driver. A caller that needs a capability
 * the driver lacks handles it by policy; nothing is inferred from the client name.
 */
export type DriverCapabilities = {
  /** Steering a running turn is native to the client (not a new turn). */
  steer: boolean;
  interrupt: boolean;
  /** How the client asks before it acts: answered by the session, or through a DPF MCP tool. */
  runtimeRequests: "session" | "permission-tool";
  resumeThread: boolean;
  /** The client reports per-turn usage. */
  usage: boolean;
  /** One-shot runs without a long-lived session (Build Studio dispatch, inference routing). */
  oneShot: boolean;
};

export type ExecutorDriver = {
  provider: RuntimeProvider;
  capabilities: DriverCapabilities;
  openSession(config: RuntimeSessionConfig, onEvent: RuntimeEventSink): Promise<RuntimeSession>;
};
