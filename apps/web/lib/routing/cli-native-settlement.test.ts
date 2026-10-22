import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: { toolExecution: { count: vi.fn() } } }));

import { prisma } from "@dpf/db";
import { NativeCliExecutionUncertainError } from "./cli-owned-runner";
import { InferenceError } from "./inference-error";
import { settleNativeCliWithoutEffects, NATIVE_SETTLEMENT_SKEW_MS } from "./cli-native-settlement";
import type { NativeCliDiagnostics } from "../shared/execution-uncertainty";

const dispatchedAt = new Date("2026-10-21T11:15:00.719Z");
function diagnostics(overrides: Partial<NativeCliDiagnostics> = {}, hint = "quota"): NativeCliDiagnostics {
  return { exitCode: 1, signal: null, timedOut: false, outerProcessClosed: true, stdoutPresent: true,
    stderrPresent: false, childProcessClosure: "unverified",
    terminalResult: { status: "error", type: "result", subtype: "success", isError: true,
      hint: hint as NonNullable<NativeCliDiagnostics["terminalResult"]>["hint"] },
    ...overrides };
}
function uncertain(...args: [NativeCliDiagnostics | undefined] | []) {
  return new NativeCliExecutionUncertainError("anthropic-sub", args.length === 0 ? diagnostics() : args[0]);
}
const session = { taskRunId: "TR-SCHED-B3D332F3", threadId: "thread-1" };

describe("settleNativeCliWithoutEffects", () => {
  it("settles a self-terminated quota envelope with an empty governed ledger as a rate limit", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const log = vi.fn();
    const settled = await settleNativeCliWithoutEffects({ error: uncertain(), session, dispatchedAt }, { countLedgerRows: count, log });
    expect(settled).toBeInstanceOf(InferenceError);
    expect(settled).toMatchObject({ code: "rate_limit", providerId: "anthropic-sub" });
    expect(settled?.message).toMatch(/usage limit/i);
    expect(settled?.message).toMatch(/no governed effects/i);
    expect(count).toHaveBeenCalledWith({ taskRunId: "TR-SCHED-B3D332F3", threadId: "thread-1",
      since: new Date(dispatchedAt.getTime() - NATIVE_SETTLEMENT_SKEW_MS) });
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0][0])).toMatch(/settled-without-effects.*taskRunId=TR-SCHED-B3D332F3.*ledgerRows=0/);
  });

  it.each([
    ["unclassified", "provider_error"], ["auth", "auth"], ["overloaded", "overloaded"], ["model", "model_not_found"],
  ])("maps a %s envelope to %s", async (hint, code) => {
    const settled = await settleNativeCliWithoutEffects({ error: uncertain(diagnostics({}, hint)), session, dispatchedAt },
      { countLedgerRows: async () => 0, log: () => {} });
    expect(settled).toMatchObject({ code });
  });

  it("reads the default ledger by taskRunId or thread since dispatch", async () => {
    vi.mocked(prisma.toolExecution.count).mockResolvedValueOnce(0 as never);
    await settleNativeCliWithoutEffects({ error: uncertain(), session, dispatchedAt }, { log: () => {} });
    expect(prisma.toolExecution.count).toHaveBeenCalledWith({ where: {
      createdAt: { gte: new Date(dispatchedAt.getTime() - NATIVE_SETTLEMENT_SKEW_MS) },
      OR: [{ taskRunId: "TR-SCHED-B3D332F3" }, { threadId: "thread-1" }],
    } });
  });

  it.each<[string, NativeCliDiagnostics | undefined]>([
    ["timed out", diagnostics({ timedOut: true })],
    ["signalled", diagnostics({ signal: "SIGKILL" })],
    ["no exit code", diagnostics({ exitCode: null })],
    ["runner timeout exit", diagnostics({ exitCode: 124 })],
    ["outer process not closed", diagnostics({ outerProcessClosed: false })],
    ["no terminal envelope", diagnostics({ terminalResult: undefined })],
    ["unparsed envelope", diagnostics({ terminalResult: { status: "unknown", type: "unknown", subtype: "unknown", isError: null, hint: "unclassified" } })],
    ["successful envelope", diagnostics({ terminalResult: { status: "success", type: "result", subtype: "success", isError: false, hint: "unclassified" } })],
    ["no diagnostics", undefined],
  ])("keeps the hold when the process is %s", async (_label, d) => {
    const count = vi.fn().mockResolvedValue(0);
    expect(await settleNativeCliWithoutEffects({ error: uncertain(d), session, dispatchedAt }, { countLedgerRows: count, log: () => {} })).toBeNull();
    expect(count).not.toHaveBeenCalled();
  });

  it("keeps the hold when any governed call, including a reservation, was recorded", async () => {
    expect(await settleNativeCliWithoutEffects({ error: uncertain(), session, dispatchedAt },
      { countLedgerRows: async () => 1, log: () => {} })).toBeNull();
  });

  it("keeps the hold when the ledger cannot be read", async () => {
    expect(await settleNativeCliWithoutEffects({ error: uncertain(), session, dispatchedAt },
      { countLedgerRows: async () => { throw new Error("db down"); }, log: () => {} })).toBeNull();
  });

  it("keeps the hold without a TaskRun to reconcile against", async () => {
    const count = vi.fn().mockResolvedValue(0);
    expect(await settleNativeCliWithoutEffects({ error: uncertain(), session: { threadId: "thread-1" }, dispatchedAt },
      { countLedgerRows: count, log: () => {} })).toBeNull();
    expect(count).not.toHaveBeenCalled();
  });

  it("ignores errors that are not native execution uncertainty", async () => {
    expect(await settleNativeCliWithoutEffects({ error: new Error("x"), session, dispatchedAt },
      { countLedgerRows: async () => 0, log: () => {} })).toBeNull();
  });
});
