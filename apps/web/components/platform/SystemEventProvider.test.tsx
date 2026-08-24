// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SystemEventProvider, useSystemEvent } from "./SystemEventProvider";

const resilient = vi.hoisted(() => ({
  options: null as null | { onMessage: (event: MessageEvent) => void },
  calls: 0,
}));

vi.mock("@/lib/hooks/useResilientEventSource", () => ({
  useResilientEventSource: (
    _url: string,
    options: { onMessage: (event: MessageEvent) => void },
  ) => {
    resilient.calls += 1;
    resilient.options = options;
    return { status: "open" as const };
  },
}));

function Listener({ onEvent }: { onEvent: (runId: string) => void }) {
  useSystemEvent("system:self-upgrade", (event) => onEvent(event.runId));
  return null;
}

function LocalModelListener({ onEvent }: { onEvent: (operationId: string) => void }) {
  useSystemEvent("system:local-model", (event) => onEvent(event.operationId));
  return null;
}

describe("SystemEventProvider", () => {
  beforeEach(() => {
    resilient.options = null;
    resilient.calls = 0;
  });

  it("owns one resilient stream for multiple consumers", () => {
    const first = vi.fn();
    const second = vi.fn();

    render(
      <SystemEventProvider>
        <Listener onEvent={first} />
        <Listener onEvent={second} />
      </SystemEventProvider>,
    );

    expect(resilient.calls).toBe(1);
    resilient.options?.onMessage(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "system:self-upgrade",
          runId: "SUR-1",
          status: "running",
          observedAt: "2026-08-01T00:00:00.000Z",
        }),
      }),
    );

    expect(first).toHaveBeenCalledWith("SUR-1");
    expect(second).toHaveBeenCalledWith("SUR-1");
  });

  it("isolates a failing subscriber and ignores malformed events", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const survivor = vi.fn();
    function ThrowingListener() {
      useSystemEvent("system:self-upgrade", () => {
        throw new Error("consumer failed");
      });
      return null;
    }

    render(
      <SystemEventProvider>
        <ThrowingListener />
        <Listener onEvent={survivor} />
      </SystemEventProvider>,
    );

    expect(() => {
      resilient.options?.onMessage(new MessageEvent("message", { data: "not-json" }));
      resilient.options?.onMessage(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "system:self-upgrade",
            runId: "SUR-2",
            status: "succeeded",
            observedAt: "2026-08-01T00:00:01.000Z",
          }),
        }),
      );
    }).not.toThrow();
    expect(survivor).toHaveBeenCalledWith("SUR-2");
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it("delivers local model invalidations through the shared stream", () => {
    const onEvent = vi.fn();
    render(
      <SystemEventProvider>
        <LocalModelListener onEvent={onEvent} />
      </SystemEventProvider>,
    );

    resilient.options?.onMessage(new MessageEvent("message", {
      data: JSON.stringify({
        type: "system:local-model",
        operationId: "local-model-install:abc",
        modelReference: "ai/qwen3:8B-Q4_K_M",
        status: "running",
        observedAt: "2026-08-24T01:00:00.000Z",
      }),
    }));

    expect(onEvent).toHaveBeenCalledWith("local-model-install:abc");
  });
});
