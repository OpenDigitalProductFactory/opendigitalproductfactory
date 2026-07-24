// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAsyncAction, useSaveState } from "./use-save-state";

afterEach(() => {
  vi.useRealTimers();
});

describe("useSaveState", () => {
  it("goes pending then saved on a successful change, and value updates optimistically", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useSaveState<number>({ value: 1, onSave }));

    expect(result.current.status).toBe("idle");

    act(() => result.current.change(2));

    expect(result.current.value).toBe(2); // optimistic, before the promise resolves
    expect(result.current.status).toBe("pending");

    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(onSave).toHaveBeenCalledWith(2);
  });

  it("snaps the value back to the last confirmed value and exposes an error on a handled failure", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: false, error: "Server says no" });
    const { result } = renderHook(() => useSaveState<number>({ value: 1, onSave }));

    act(() => result.current.change(2));
    await waitFor(() => expect(result.current.status).toBe("failed"));

    expect(result.current.value).toBe(1); // reverted
    expect(result.current.error).toBe("Server says no");
  });

  it("treats a thrown/rejected onSave the same as a handled failure, with the fallback message", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() =>
      useSaveState<number>({ value: 1, onSave, failureMessage: "Couldn't save. Try again." }),
    );

    act(() => result.current.change(2));
    await waitFor(() => expect(result.current.status).toBe("failed"));

    expect(result.current.value).toBe(1);
    expect(result.current.error).toBe("Couldn't save. Try again.");
  });

  it("retry() re-attempts the same value that failed", async () => {
    const onSave = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true });
    const { result } = renderHook(() => useSaveState<number>({ value: 1, onSave }));

    act(() => result.current.change(2));
    await waitFor(() => expect(result.current.status).toBe("failed"));

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("saved"));

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenNthCalledWith(2, 2);
    expect(result.current.value).toBe(2);
  });

  it("revert() dismisses a failed status without retrying", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: false });
    const { result } = renderHook(() => useSaveState<number>({ value: 1, onSave }));

    act(() => result.current.change(2));
    await waitFor(() => expect(result.current.status).toBe("failed"));

    act(() => result.current.revert());

    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeNull();
    expect(result.current.value).toBe(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("debounces change() and only persists the settled value once", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useSaveState<number>({ value: 1, onSave, debounceMs: 500 }));

    act(() => result.current.change(2));
    act(() => result.current.change(3));
    act(() => result.current.change(4));

    expect(onSave).not.toHaveBeenCalled();
    expect(result.current.hasPendingChange()).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(4);
  });

  it("flushes a pending debounced save on unmount instead of dropping it", () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue({ ok: true });
    const { result, unmount } = renderHook(() => useSaveState<number>({ value: 1, onSave, debounceMs: 500 }));

    act(() => result.current.change(2));
    expect(onSave).not.toHaveBeenCalled();

    unmount();

    expect(onSave).toHaveBeenCalledWith(2);
  });

  it("reconciles an external value change only while idle, never clobbering an in-flight edit", async () => {
    let resolveSave!: (v: { ok: boolean }) => void;
    const onSave = vi.fn(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const { result, rerender } = renderHook(({ value }) => useSaveState<number>({ value, onSave }), {
      initialProps: { value: 1 },
    });

    act(() => result.current.change(2));
    expect(result.current.status).toBe("pending");

    // A prop update arrives while the save is still in flight — must not
    // clobber the optimistic value.
    rerender({ value: 99 });
    expect(result.current.value).toBe(2);

    await act(async () => {
      resolveSave({ ok: true });
    });
    expect(result.current.status).toBe("saved");
  });

  it("resetKey: flushes a pending save against the OLD subject and resets status for the new one", async () => {
    vi.useFakeTimers();
    const saveA = vi.fn().mockResolvedValue({ ok: true });
    const saveB = vi.fn().mockResolvedValue({ ok: true });

    const { result, rerender } = renderHook(
      ({ subject, value }: { subject: string; value: number }) =>
        useSaveState<number>({
          value,
          onSave: subject === "a" ? saveA : saveB,
          debounceMs: 500,
          resetKey: subject,
        }),
      { initialProps: { subject: "a", value: 1 } },
    );

    act(() => result.current.change(2));
    expect(saveA).not.toHaveBeenCalled();

    // Switch subjects before the debounce fires.
    rerender({ subject: "b", value: 10 });

    // The pending change for "a" was flushed against saveA (not saveB).
    expect(saveA).toHaveBeenCalledWith(2);
    expect(saveB).not.toHaveBeenCalled();
    // Local state reset to the new subject's value/status.
    expect(result.current.value).toBe(10);
    expect(result.current.status).toBe("idle");
  });
});

describe("useAsyncAction", () => {
  it("shares the same pending/failed/retry machinery for a one-shot action", async () => {
    const run = vi.fn().mockResolvedValueOnce({ ok: false, error: "Nope" }).mockResolvedValueOnce({ ok: true });
    const { result } = renderHook(() => useAsyncAction<{ text: string }>(run));

    expect(result.current.status).toBe("idle");

    act(() => result.current.run({ text: "hello" }));
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.error).toBe("Nope");

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(run).toHaveBeenCalledTimes(2);
  });
});
