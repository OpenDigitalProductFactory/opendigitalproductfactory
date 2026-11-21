// apps/web/lib/build/t3-code/t3-coding-session-port.ts
//
// BI-4B4CF969 (WWMD DI-C19B8FEBCF0E): DPF's port to T3 Code's coding
// orchestration. DPF keeps authority and durable dispatch (the Workroom outbox,
// BI-EB4BB4A0); a T3 Code thread does the coding session.
//
// The shapes follow T3 Code's own orchestrator thread contract, as its MCP
// tools return it: t3_thread_launch and delegate_task create a thread, and
// t3_thread_read returns the thread's providerInstanceId and its runs. Each
// run carries runId, status, providerInstanceId, model, executedModel,
// requestedAt and completedAt. No T3 code is copied.
//
// No production adapter implements this port yet. The portal has no route or
// credential to a T3 Code server; that arrives with S6 execution hosts
// (BI-5A866218) or an owner-granted route.

/** T3 Code's provider instance ids for the model clients DPF's build runners drive. */
export type T3ProviderInstanceId = "claudeAgent" | "codex";

export const T3_PROVIDER_FOR_CLIENT = {
  claude: "claudeAgent",
  codex: "codex",
} as const satisfies Record<"claude" | "codex", T3ProviderInstanceId>;

/** What ties a T3 thread back to the DPF work it does. */
export type T3ThreadCorrelation = {
  /** Deterministic: one thread per build task (see t3ClientKey). */
  clientKey: string;
  buildId: string;
  taskIndex: number;
  taskTitle: string;
};

export type T3RunReadback = {
  runId: string;
  /** T3 run status, for example requested | running | completed | failed | interrupted | cancelled. */
  status: string;
  providerInstanceId: string;
  model: string | null;
  executedModel: string | null;
  requestedAt: string;
  completedAt: string | null;
};

export type T3ThreadReadback = {
  threadId: string;
  providerInstanceId: string;
  status: string;
  /** Oldest first. */
  runs: T3RunReadback[];
  /** The thread's last assistant message, once a run has completed. */
  finalAssistantText: string | null;
};

export interface T3CodingSessionPort {
  launchThread(input: {
    title: string;
    prompt: string;
    providerInstanceId: T3ProviderInstanceId;
    model: string | null;
    correlation: T3ThreadCorrelation;
  }): Promise<{ threadId: string }>;
  /** null when T3 no longer knows the thread. */
  readThread(threadId: string): Promise<T3ThreadReadback | null>;
}

/**
 * Where DPF remembers which T3 thread does which build task. The production
 * binding belongs on the build's Workroom log, not on a new store. Binding a
 * key twice keeps the first thread.
 */
export interface T3ThreadBindingStore {
  get(clientKey: string): Promise<string | null>;
  bind(clientKey: string, threadId: string): Promise<void>;
}

/** T3 Code cannot be reached, or refused the launch. The caller falls back; nothing ran. */
export class T3UnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "T3UnavailableError";
  }
}
