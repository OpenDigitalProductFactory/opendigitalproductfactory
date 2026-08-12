// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBackgroundOperationObserver } from "./useBackgroundOperationObserver";

const systemEvents = vi.hoisted(() => ({
  handler: null as null | (() => void),
  status: "open" as "connecting" | "open" | "reconnecting",
}));

vi.mock("@/components/platform/SystemEventProvider", () => ({
  useSystemEvent: (_type: string, handler: () => void) => {
    systemEvents.handler = handler;
  },
  useSystemEventConnectionStatus: () => systemEvents.status,
}));

type Snapshot = { revision: number; active: boolean; reconcile?: boolean };

function response(snapshot: Snapshot): Response {
  return { ok: true, json: async () => snapshot } as Response;
}

describe("useBackgroundOperationObserver", () => {
  beforeEach(() => {
    systemEvents.handler = null;
    systemEvents.status = "open";
    vi.stubGlobal("fetch", vi.fn());
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("coalesces overlapping invalidations into one follow-up read", async () => {
    const resolvers: Array<(value: Response) => void> = [];
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const { result } = renderHook(() =>
      useBackgroundOperationObserver<Snapshot>({
        endpoint: "/api/status",
        eventType: "system:self-upgrade",
        initialSnapshot: { revision: 0, active: true },
        isActive: (snapshot) => snapshot.active,
      }),
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      const first = result.current.refresh();
      const second = result.current.refresh();
      systemEvents.handler?.();
      expect(fetch).toHaveBeenCalledTimes(1);
      resolvers[0](response({ revision: 1, active: true }));
      await Promise.all([first, second]);
    });
    expect(fetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolvers[1](response({ revision: 2, active: false }));
      await Promise.resolve();
    });

    expect(result.current.snapshot.revision).toBe(2);
  });

  it("aborts an in-flight request when the observer unmounts", async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementation((_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    const { unmount } = renderHook(() =>
      useBackgroundOperationObserver<Snapshot>({
        endpoint: "/api/status",
        eventType: "system:self-upgrade",
        initialSnapshot: { revision: 0, active: true },
        isActive: (snapshot) => snapshot.active,
      }),
    );

    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("pauses fallback reconciliation while the document is hidden", async () => {
    vi.useFakeTimers();
    systemEvents.status = "reconnecting";
    vi.mocked(fetch).mockResolvedValue(response({ revision: 1, active: true }));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    renderHook(() =>
      useBackgroundOperationObserver<Snapshot>({
        endpoint: "/api/status",
        eventType: "system:self-upgrade",
        initialSnapshot: { revision: 0, active: true },
        isActive: (snapshot) => snapshot.active,
        fallbackBaseMs: 1_000,
        jitterMs: 0,
      }),
    );

    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(fetch).not.toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => Promise.resolve());
    expect(fetch).toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/status");
  });

  it("retries a failed projection read even while the event stream is open", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("temporary projection failure"))
      .mockResolvedValueOnce(response({ revision: 1, active: false }));

    const { result } = renderHook(() =>
      useBackgroundOperationObserver<Snapshot>({
        endpoint: "/api/status",
        eventType: "system:self-upgrade",
        initialSnapshot: { revision: 0, active: true },
        isActive: (snapshot) => snapshot.active,
        fallbackBaseMs: 1_000,
        jitterMs: 0,
      }),
    );

    await act(async () => Promise.resolve());
    expect(result.current.error).toContain("temporary projection failure");

    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.current.snapshot).toEqual({ revision: 1, active: false });
    expect(result.current.error).toBeNull();
  });
});
