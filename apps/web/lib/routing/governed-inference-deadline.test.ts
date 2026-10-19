import { afterEach, describe, expect, it, vi } from "vitest";
import { withInferenceOrigin } from "@/lib/inference/inference-admission";
import { assertGovernedInferenceAuthority, currentGovernedInferenceDeadline, withGovernedInferenceDeadline,
  withInferenceAuthorityCheck } from "./governed-inference-deadline";

afterEach(() => vi.useRealTimers());
const scope = (verifyAuthority = async () => true) => ({
  deadlineAt: new Date(Date.now() + 900_000).toISOString(), verifyAuthority,
});

describe("narrowing caller authority", () => {
  it("rechecks current authority after a queued caller becomes eligible without creating a parent deadline", async () => {
    let authorized = true;
    const check = vi.fn(async () => authorized);
    await withInferenceAuthorityCheck(check, async () => {
      expect(currentGovernedInferenceDeadline()).toBeUndefined();
      await assertGovernedInferenceAuthority();
      authorized = false;
      await expect(assertGovernedInferenceAuthority()).rejects.toThrow("authority-lost");
    });
    expect(check).toHaveBeenCalledTimes(2);
    expect(currentGovernedInferenceDeadline()).toBeUndefined();
    await expect(assertGovernedInferenceAuthority()).resolves.toBeUndefined();
  });

  it("cannot replace an inherited check with a permissive nested one", async () => {
    const inner = vi.fn(async () => true);
    await withInferenceAuthorityCheck(async () => false, async () => {
      await expect(withInferenceAuthorityCheck(inner, () => assertGovernedInferenceAuthority()))
        .rejects.toThrow("authority-lost");
    });
    expect(inner).not.toHaveBeenCalled();
  });

  it("preserves a real parent's absolute deadline and does not revoke it on a narrower refusal", async () => {
    await withGovernedInferenceDeadline(scope(), async () => {
      const parent = currentGovernedInferenceDeadline()!;
      await expect(withInferenceAuthorityCheck(async () => false, () => assertGovernedInferenceAuthority()))
        .rejects.toThrow("authority-lost");
      expect(currentGovernedInferenceDeadline()).toBe(parent);
      expect(parent.signal.aborted).toBe(false);
      await expect(assertGovernedInferenceAuthority()).resolves.toBeUndefined();
    });
  });

  it("lets caller cancellation interrupt an unavailable authority read", async () => {
    const caller = new AbortController();
    const reason = new Error("caller canceled while queued authority was unavailable");
    await withInferenceAuthorityCheck(() => new Promise<boolean>(() => {}), async () => {
      const waiting = assertGovernedInferenceAuthority(caller.signal);
      const assertion = expect(waiting).rejects.toBe(reason);
      caller.abort(reason);
      await assertion;
    });
  });

  it("fails closed when current authority cannot be read", async () => {
    await expect(withInferenceAuthorityCheck(async () => { throw new Error("private database detail"); },
      () => assertGovernedInferenceAuthority())).rejects.toThrow("authority-unavailable");
  });
});

describe("governed inference deadline", () => {
  it("stops a shorter caller waiting on hung authority without revoking the parent", async () => {
    let checks = 0;
    await withGovernedInferenceDeadline(scope(async () => {
      if (++checks === 1) return true;
      return new Promise<boolean>(() => {});
    }), async () => {
      const caller = new AbortController();
      const reason = new Error("utility expired during authority check");
      let result: unknown;
      const waiting = assertGovernedInferenceAuthority(caller.signal).catch(error => { result = error; });
      caller.abort(reason);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(result).toBe(reason);
      expect(currentGovernedInferenceDeadline()!.signal.aborted).toBe(false);
      await waiting;
    });
  });

  it("does not infer authority from autonomous origin alone", () => {
    withInferenceOrigin("autonomous", () => expect(currentGovernedInferenceDeadline()).toBeUndefined());
  });
  it("refuses missing authority before executing", async () => {
    const execute = vi.fn();
    await expect(withGovernedInferenceDeadline(scope(async () => false), execute)).rejects.toThrow("authority-lost");
    expect(execute).not.toHaveBeenCalled();
  });
  it("keeps an absolute deadline and disposes timers and scope", async () => {
    vi.useFakeTimers();
    await withGovernedInferenceDeadline(scope(), async () => {
      const bound = currentGovernedInferenceDeadline()!;
      await vi.advanceTimersByTimeAsync(610_000);
      expect(bound.signal.aborted).toBe(false);
      expect(bound.deadlineAt - Date.now()).toBe(290_000);
      await vi.advanceTimersByTimeAsync(290_000);
      expect(bound.signal.aborted).toBe(true);
      await expect(assertGovernedInferenceAuthority()).rejects.toThrow("deadline-exhausted");
    });
    expect(currentGovernedInferenceDeadline()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("aborts running work when the authority or generation is lost", async () => {
    vi.useFakeTimers();
    let owned = true;
    await withGovernedInferenceDeadline(scope(async () => owned), async () => {
      const bound = currentGovernedInferenceDeadline()!;
      owned = false;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(bound.signal.aborted).toBe(true);
      await expect(assertGovernedInferenceAuthority()).rejects.toThrow("authority-lost");
    });
  });
  it("revalidates immediately before fallback dispatch, without waiting for the watcher", async () => {
    let owned = true;
    await withGovernedInferenceDeadline(scope(async () => owned), async () => {
      await assertGovernedInferenceAuthority();
      owned = false;
      await expect(assertGovernedInferenceAuthority()).rejects.toThrow("authority-lost");
    });
  });
  it.each(["invalid", new Date(0).toISOString()])("rejects invalid/expired deadline %s", async deadlineAt => {
    const execute = vi.fn();
    await expect(withGovernedInferenceDeadline({ ...scope(), deadlineAt }, execute)).rejects.toThrow("deadline");
    expect(execute).not.toHaveBeenCalled();
  });
});

it("does not wait forever for an unavailable authority store", async () => {
  vi.useFakeTimers();
  const execute = vi.fn();
  const outcome = withGovernedInferenceDeadline({ deadlineAt: new Date(Date.now() + 100).toISOString(),
    verifyAuthority: () => new Promise<boolean>(() => {}) }, execute).catch(error => error);
  await vi.advanceTimersByTimeAsync(100);
  expect(await outcome).toMatchObject({ message: "inference-parent-deadline-exhausted" });
  expect(execute).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("does not allow a nested scope to reset the parent's window", async () => {
  await withGovernedInferenceDeadline(scope(), async () => {
    await expect(withGovernedInferenceDeadline(scope(), async () => undefined)).rejects.toThrow("already-bound");
  });
});
