// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useResilientEventSource,
  HEARTBEAT_WATCHDOG_MS,
} from "./useResilientEventSource";
import { SSE_HEARTBEAT_EVENT } from "@/lib/sse/constants";

// ── Controllable EventSource mock ───────────────────────────────────────────
// jsdom has no EventSource. This mock records every constructed instance and
// lets the test drive open / message / named-event / error callbacks.
class MockEventSource {
  static instances: MockEventSource[] = [];
  static reset() {
    MockEventSource.instances = [];
  }

  url: string;
  closed = false;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  private listeners: Record<string, Set<(e: MessageEvent) => void>> = {};

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(name: string, fn: (e: MessageEvent) => void): void {
    (this.listeners[name] ??= new Set()).add(fn);
  }
  removeEventListener(name: string, fn: (e: MessageEvent) => void): void {
    this.listeners[name]?.delete(fn);
  }
  close(): void {
    this.closed = true;
  }

  // test drivers
  emitOpen(): void {
    this.onopen?.(new Event("open"));
  }
  emitMessage(data: string): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
  emitNamed(name: string, data: string): void {
    const ev = new MessageEvent(name, { data });
    this.listeners[name]?.forEach((fn) => fn(ev));
  }
}

const realEventSource = globalThis.EventSource;

beforeEach(() => {
  vi.useFakeTimers();
  MockEventSource.reset();
  (globalThis as unknown as { EventSource: unknown }).EventSource =
    MockEventSource;
});

afterEach(() => {
  vi.useRealTimers();
  (globalThis as unknown as { EventSource: unknown }).EventSource =
    realEventSource;
});

describe("useResilientEventSource heartbeat watchdog", () => {
  it("force-reconnects when no heartbeat arrives within the watchdog window", () => {
    const onMessage = vi.fn();
    renderHook(() => useResilientEventSource("/api/agent/system-stream", { onMessage }));

    expect(MockEventSource.instances).toHaveLength(1);
    act(() => MockEventSource.instances[0].emitOpen());

    // Silence past the watchdog → it should close the source and schedule a
    // reconnect (this is the zombie-connection reaper).
    act(() => {
      vi.advanceTimersByTime(HEARTBEAT_WATCHDOG_MS + 1);
    });
    expect(MockEventSource.instances[0].closed).toBe(true);

    // After the reconnect backoff (5s floor is waived since >5s already
    // elapsed, leaving only <=1s jitter) a fresh connection opens.
    act(() => {
      vi.advanceTimersByTime(1_100);
    });
    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[1].closed).toBe(false);
  });

  it("does NOT reconnect while heartbeats keep arriving", () => {
    const onMessage = vi.fn();
    renderHook(() => useResilientEventSource("/api/agent/system-stream", { onMessage }));
    act(() => MockEventSource.instances[0].emitOpen());

    // A heartbeat every 15s for 60s total — each resets the watchdog.
    for (let i = 0; i < 4; i++) {
      act(() => {
        vi.advanceTimersByTime(15_000);
      });
      act(() => {
        MockEventSource.instances[0].emitNamed(SSE_HEARTBEAT_EVENT, JSON.stringify({ t: i }));
      });
    }
    // A bit more, still under the watchdog since the last beat.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].closed).toBe(false);
    // Heartbeats are internal — never surfaced to the consumer.
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("data frames also reset the watchdog and reach the consumer", () => {
    const onMessage = vi.fn();
    renderHook(() => useResilientEventSource("/api/agent/stream?threadId=t1", { onMessage }));
    act(() => MockEventSource.instances[0].emitOpen());

    for (let i = 0; i < 3; i++) {
      act(() => {
        vi.advanceTimersByTime(20_000);
      });
      act(() => {
        MockEventSource.instances[0].emitMessage(JSON.stringify({ type: "tick", i }));
      });
    }
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(MockEventSource.instances).toHaveLength(1);
    expect(onMessage).toHaveBeenCalledTimes(3);
  });

  it("tears down the connection and timers on unmount", () => {
    const onMessage = vi.fn();
    const { unmount } = renderHook(() =>
      useResilientEventSource("/api/agent/system-stream", { onMessage }),
    );
    act(() => MockEventSource.instances[0].emitOpen());
    unmount();
    expect(MockEventSource.instances[0].closed).toBe(true);

    // No reconnect should be scheduled after unmount.
    act(() => {
      vi.advanceTimersByTime(HEARTBEAT_WATCHDOG_MS + 10_000);
    });
    expect(MockEventSource.instances).toHaveLength(1);
  });
});
