// apps/web/lib/build/t3-code/t3-harness-runner.ts
//
// BI-4B4CF969 (WWMD DI-C19B8FEBCF0E): a Build Studio runner that does a build
// task as a T3 Code thread. It is the DPF-owned adapter at the runner seam
// (BuildAgentRunner). Today, by contrast, every build task runs as a one-shot
// `claude -p` / `codex exec` in dpf-sandbox-1.
//
// The runner keeps the model client's id (claude | codex), and T3 Code is
// recorded as the harness. This follows BI-53BED66C D5: the harness is not the
// authenticated client.
//
// What it proves, and records on every result as `t3`:
// - threadCreated: one T3 thread per build task, keyed by t3ClientKey. A task
//   already bound to a thread is read back and never launched again.
// - providerAttemptObserved: T3 reported a run for the thread.
// - correlated: that run was executed by the provider instance requested for
//   this client.
// - readBack: a terminal run and its result were read back from T3.
// Each failure is typed and never reported as success: t3-unavailable,
// t3-timeout, t3-provider-mismatch, t3-run-failed.
//
// Not registered in getBuildAgentRunner: no production route or credential to
// T3 Code exists yet.

import type {
  AgentRunResult,
  AgentRunSpec,
  BuildAgentRunner,
  BuildAgentRunnerCapabilities,
} from "../sandbox/agent-runner-types";
import type { BuildExecutionProvider, SandboxHandle } from "../sandbox/provider-types";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import {
  T3_PROVIDER_FOR_CLIENT,
  type T3CodingSessionPort,
  type T3RunReadback,
  type T3ThreadBindingStore,
} from "./t3-coding-session-port";

export type T3DispatchOutcome = "succeeded" | "t3-unavailable" | "t3-timeout" | "t3-provider-mismatch" | "t3-run-failed";

export type T3DispatchReceipt = {
  harness: "t3-code";
  clientKey: string;
  threadId: string | null;
  runId: string | null;
  requestedProviderInstanceId: string;
  observedProviderInstanceId: string | null;
  executedModel: string | null;
  threadCreated: boolean;
  resumed: boolean;
  providerAttemptObserved: boolean;
  correlated: boolean;
  readBack: boolean;
  outcome: T3DispatchOutcome;
};

export type T3AgentRunResult = AgentRunResult & { t3: T3DispatchReceipt };

/** A BuildAgentRunner whose results also carry the T3 dispatch receipt. */
export type T3HarnessRunner = Omit<BuildAgentRunner, "run"> & {
  run(provider: BuildExecutionProvider, handle: SandboxHandle, spec: AgentRunSpec): Promise<T3AgentRunResult>;
};

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "interrupted", "cancelled"]);

/** One T3 thread per build task. */
export const t3ClientKey = (buildId: string, taskIndex: number) => `dpf-build:${buildId}:task:${taskIndex}`;

function taskPrompt(spec: AgentRunSpec): { title: string; prompt: string; taskIndex: number } {
  const task = spec.task;
  const title = task?.title ?? spec.title ?? "Build task";
  const parts = [
    spec.buildContext ? `Context: ${spec.buildContext}` : null,
    `Task: ${title}`,
    task?.task.testFirst ? `Test first: ${task.task.testFirst}` : null,
    task?.task.implement ? `Implement: ${task.task.implement}` : spec.prompt ? `Implement: ${spec.prompt}` : null,
    task?.task.verify ? `Verify: ${task.task.verify}` : null,
    spec.priorResults ? `Prior results:\n${spec.priorResults}` : null,
  ];
  return { title, prompt: parts.filter(Boolean).join("\n\n"), taskIndex: task?.taskIndex ?? 0 };
}

const latestRun = (runs: T3RunReadback[]) => (runs.length ? runs[runs.length - 1]! : null);

export function createT3HarnessRunner(deps: {
  client: "claude" | "codex";
  port: T3CodingSessionPort;
  bindings: T3ThreadBindingStore;
  pollIntervalMs?: number;
  /** How long to wait for a terminal run before reporting t3-timeout (the thread stays bound). */
  deadlineMs?: number;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Called with every receipt, so the caller can write it to the build's Workroom log. */
  onReceipt?: (receipt: T3DispatchReceipt) => void;
}): T3HarnessRunner {
  const pollIntervalMs = deps.pollIntervalMs ?? 5_000;
  const deadlineMs = deps.deadlineMs ?? 40 * 60_000;
  const clock = deps.clock ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const requestedProvider = T3_PROVIDER_FOR_CLIENT[deps.client];

  const capabilities: BuildAgentRunnerCapabilities = {
    tier: "full-spec-implement",
    // The T3 thread holds the session and the account; the DPF sandbox holds neither.
    requiresPersistentSession: false,
    requiresCredential: false,
    honorsLlmBaseUrl: false,
  };

  return {
    id: deps.client,
    capabilities: () => capabilities,
    async prepare(): Promise<void> {
      // Nothing to inject: T3 Code runs the client under its own account.
    },
    async run(provider, _handle, spec): Promise<T3AgentRunResult> {
      const started = clock();
      const { title, prompt, taskIndex } = taskPrompt(spec);
      const clientKey = spec.buildId ? t3ClientKey(spec.buildId, taskIndex) : "";
      const receipt: T3DispatchReceipt = {
        harness: "t3-code", clientKey, threadId: null, runId: null,
        requestedProviderInstanceId: requestedProvider, observedProviderInstanceId: null, executedModel: null,
        threadCreated: false, resumed: false, providerAttemptObserved: false, correlated: false, readBack: false,
        outcome: "t3-unavailable",
      };
      const finish = (outcome: T3DispatchOutcome, stdout: string, reason: string): T3AgentRunResult => {
        receipt.outcome = outcome;
        deps.onReceipt?.({ ...receipt });
        return {
          exitCode: outcome === "succeeded" ? 0 : 1,
          stdout,
          stderr: outcome === "succeeded" ? "" : `${outcome}: ${reason}`,
          durationMs: clock() - started,
          toolExecutionId: receipt.threadId && receipt.runId ? `t3:${receipt.threadId}:${receipt.runId}` : `t3:${clientKey || "unkeyed"}`,
          agentId: deps.client,
          providerId: provider.id,
          t3: { ...receipt },
        };
      };

      if (!spec.buildId) return finish("t3-unavailable", "", "the task names no build, so it cannot be correlated to a T3 thread");

      // One thread per task: resume a bound thread rather than launching a second.
      try {
        const bound = await deps.bindings.get(clientKey);
        if (bound) {
          receipt.threadId = bound;
          receipt.resumed = true;
        } else {
          const { threadId } = await deps.port.launchThread({
            title, prompt, providerInstanceId: requestedProvider, model: spec.model ?? null,
            correlation: { clientKey, buildId: spec.buildId, taskIndex, taskTitle: title },
          });
          receipt.threadId = threadId;
          receipt.threadCreated = true;
          await deps.bindings.bind(clientKey, threadId);
        }
      } catch (error) {
        return finish("t3-unavailable", "", getErrorMessage(error));
      }

      const threadId = receipt.threadId!;
      for (;;) {
        let thread;
        try {
          thread = await deps.port.readThread(threadId);
        } catch (error) {
          return finish("t3-unavailable", "", getErrorMessage(error));
        }
        if (!thread) return finish("t3-unavailable", "", `T3 no longer knows thread ${threadId}`);
        const run = latestRun(thread.runs);
        if (run) {
          receipt.providerAttemptObserved = true;
          receipt.runId = run.runId;
          receipt.observedProviderInstanceId = run.providerInstanceId;
          receipt.correlated = run.providerInstanceId === requestedProvider;
          if (TERMINAL_RUN_STATUSES.has(run.status)) {
            receipt.readBack = true;
            receipt.executedModel = run.executedModel;
            if (!receipt.correlated) {
              return finish("t3-provider-mismatch", "", `run ${run.runId} was executed by ${run.providerInstanceId}, not ${requestedProvider}`);
            }
            if (run.status !== "completed") return finish("t3-run-failed", "", `run ${run.runId} ended ${run.status}`);
            return finish("succeeded", thread.finalAssistantText ?? "", "");
          }
        }
        if (clock() - started >= deadlineMs) {
          return finish("t3-timeout", "", `no terminal run on thread ${threadId} within ${deadlineMs} ms; the thread stays bound for a later readback`);
        }
        await sleep(pollIntervalMs);
      }
    },
  };
}
