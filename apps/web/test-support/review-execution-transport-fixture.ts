import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { vi } from "vitest";
import type { PrismaClient } from "../../../packages/db/generated/client/client";
import type { RemoteTaskSubmitParams } from "@/lib/mcp-task-submit-params";
import type { executeAutonomousAgenticLoop } from "@/lib/tak/autonomous-work-run";

type LoopInput = Parameters<typeof executeAutonomousAgenticLoop>[0];
type CapturedInput = Pick<LoopInput, "userId" | "agentId" | "threadId" | "routeContext"
  | "taskRunId" | "taskExecutionFence" | "tokenScope" | "tokenGrantScopes">;
const ports = vi.hoisted(() => ({
  loop: null as null | ((input: LoopInput) => Promise<never>),
  provider: vi.fn(() => { throw new Error("Provider execution is forbidden in the writer composition fixture."); }),
}));

// These ancillary ports supply no evidence of provider execution, task-creation
// admission, receipt projection or reviewer authority.
vi.mock("@/lib/tak/autonomous-work-run", () => ({
  executeAutonomousAgenticLoop: (input: LoopInput) => {
    if (!ports.loop) throw new Error("No writer composition capture is active.");
    return ports.loop(input);
  },
  resolveAutonomousWorkAgent: ports.provider,
  resolveAutonomousWorkTools: ports.provider,
}));
vi.mock("@/lib/tak/agentic-loop", () => ({ runAgenticLoop: ports.provider }));
vi.mock("@/lib/routed-inference", () => ({ routeAndCall: ports.provider }));
vi.mock("@/lib/mcp-task-reassessment-preparation", () => ({
  prepareRemoteReviewAttempt: async ({ parsed }: { parsed: RemoteTaskSubmitParams }) => ({
    agent: { agentId: parsed.agentId, systemPrompt: "Isolated writer fixture.", sensitivity: "internal" },
    resolvedAgentId: parsed.agentId,
    tools: { tools: [], toolsForProvider: [], deferredTools: [] },
    conversation: { systemPrompt: "Isolated writer fixture.", chatHistory: [] },
    modelRequirements: null, terminalToolPolicy: null,
  }),
}));
vi.mock("@/lib/mcp-task-review-sensitivity", () => ({
  remoteReviewSensitivity: async (_parsed: unknown, _token: unknown, fallback: string) => fallback,
}));
vi.mock("@/lib/mcp-task-review-outcome", () => ({
  loadTaskInitiativeReviewOutcome: async () => null,
  loadInitiativeReviewOutcome: async () => null,
  reconcilePersistedReviewStatus: () => { throw new Error("Receipt projection is outside the composition fixture."); },
}));
vi.mock("@/lib/tak/task-records", () => ({ createTaskMessage: async () => undefined }));

import { reserveSubmittedTaskRunWorking } from "@/lib/observability/heartbeat";
import { executeRemoteTaskAttempt } from "@/lib/mcp-task-execution";
import { createMcpSessionToken } from "@/lib/mcp/session-token";
import { authenticateMcpRequest, type ResolvedMcpTransportAuth } from "@/lib/mcp/transport-auth";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function bounded<T>(promise: Promise<T>, label: string, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds}ms.`)), milliseconds);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

/** Real CAS -> executor capture -> signed session -> authentication, using
 * fixture authority. This does not establish governed task-creation admission. */
export async function createReviewExecutionTransportFixture(input: {
  db: PrismaClient;
  taskRunId: string;
  requestDigest: string;
  userId: string;
  parsed: RemoteTaskSubmitParams;
  registerCleanup: (close: () => Promise<void>) => void;
}) {
  assert.equal(ports.loop, null, "A prior fixture executor has not drained.");
  ports.provider.mockClear();
  const priorSecret = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = randomBytes(32).toString("hex");
  const captured = deferred<CapturedInput>(), release = deferred<void>();
  let loopCalls = 0;
  let settled: Promise<{ ok: true } | { ok: false; error: unknown }> | undefined;
  let closePromise: Promise<void> | undefined;
  const close = () => closePromise ??= (async () => {
    release.resolve();
    try {
      if (settled) {
        const result = await bounded(settled, "Fixture executor drain", 9000);
        if (!result.ok) throw result.error;
        assert.equal(loopCalls, 1, "The original executor must enter the capture loop exactly once.");
      }
      assert.equal(ports.provider.mock.calls.length, 0, "No provider entry point may execute.");
    } finally {
      ports.loop = null;
      if (priorSecret === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = priorSecret;
    }
  })();
  // Register before any asynchronous setup. A failed setup/drain must also
  // stop the caller from truncating or dropping this executor's SQL schema.
  input.registerCleanup(close);

  ports.loop = async params => {
    loopCalls++;
    assert.equal(loopCalls, 1, "Unexpected executor redispatch.");
    captured.resolve(structuredClone({ userId: params.userId, agentId: params.agentId,
      threadId: params.threadId, routeContext: params.routeContext, taskRunId: params.taskRunId,
      taskExecutionFence: params.taskExecutionFence, tokenScope: params.tokenScope,
      tokenGrantScopes: params.tokenGrantScopes }));
    await release.promise;
    // The assertions inspect actual writer results while this loop is pending.
    // Terminating the stub is cleanup, not a fabricated successful review.
    throw new Error("Writer composition fixture loop released after its assertions.");
  };

  try {
    const task = await input.db.taskRun.findUniqueOrThrow({ where: { taskRunId: input.taskRunId } });
    assert.equal(task.status, "submitted");
    const reservation = `fixture-reservation-${randomUUID()}`, dispatchClaim = `fixture-dispatch-${randomUUID()}`;
    assert.equal(await reserveSubmittedTaskRunWorking({ taskRunId: task.taskRunId, updatedAt: task.updatedAt,
      progressPayload: { resumeReservedAt: reservation, dispatch: { claimedAt: dispatchClaim } } }), true);
    const attempt = executeRemoteTaskAttempt({ run: { id: task.id, taskRunId: task.taskRunId, contextId: task.contextId },
      threadId: "fixture-thread", token: { tokenId: "fixture-token", userId: input.userId, capability: "write", source: "pat" },
      userContext: {} as Parameters<typeof executeRemoteTaskAttempt>[0]["userContext"],
      parsed: input.parsed, idempotentReplay: false, capacityAttempt: 1,
      expectedReservation: reservation, expectedDispatchClaim: dispatchClaim });
    // Observe rejection immediately, including a failure before the loop starts.
    settled = attempt.then(() => ({ ok: true as const }), error => ({ ok: false as const, error }));
    const capture = await bounded(Promise.race([captured.promise, settled.then(result => {
      if (!result.ok) throw result.error;
      throw new Error("Fixture executor completed before capturing its loop inputs.");
    })]), "Fixture executor capture", 3000);
    assert.equal(loopCalls, 1);
    assert.equal(capture.taskRunId, input.taskRunId);
    assert.equal(capture.userId, input.userId);
    assert.equal(capture.agentId, input.parsed.agentId);
    assert.deepEqual(capture.taskExecutionFence, { schemaVersion: 1, reservation, dispatchClaim,
      authorityDigest: null, requestDigest: input.requestDigest });

    const authenticate = async (omitFence: boolean): Promise<ResolvedMcpTransportAuth> => {
      const token = await createMcpSessionToken({ userId: capture.userId, agentId: capture.agentId,
        threadId: capture.threadId, routeContext: capture.routeContext, taskRunId: capture.taskRunId,
        ...(omitFence ? {} : { taskExecutionFence: capture.taskExecutionFence }),
        scopes: ["initiative_design_review"], capability: "write" });
      const result = await authenticateMcpRequest(new Request("https://localhost/api/mcp/v1", {
        headers: { "x-mcp-session": token },
      }));
      assert.equal(result.ok, true, "The signed fixture session must authenticate.");
      if (!result.ok) throw new Error("Fixture session authentication failed.");
      assert.equal(result.token.source, "session-jwt");
      assert.equal(result.token.taskRunId, capture.taskRunId);
      assert.deepEqual(result.token.taskExecutionFence, omitFence ? undefined : capture.taskExecutionFence);
      return result.token;
    };
    const auth = await authenticate(false);
    return { capture, auth, authenticateWithoutFence: () => authenticate(true), close };
  } catch (error) {
    try { await close(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Fixture setup and cleanup failed.");
    }
    throw error;
  }
}
