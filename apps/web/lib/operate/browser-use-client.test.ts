// BI-1BAA177C — the degraded-run contract. A browser-use agent that cannot
// drive its browser must surface as BrowserUseDegradedError (NOT-RUN), never
// as empty findings or 0/N test results.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/self-upgrade/quiescence", () => ({
  getQuiescenceLevel: vi.fn().mockResolvedValue("normal"),
  QuiescingError: class QuiescingError extends Error {},
}));

import {
  BrowserUseDegradedError,
  evaluatePage,
  runBrowserUseTests,
} from "./browser-use-client";

function mcpResponse(payload: Record<string, unknown>) {
  return {
    ok: true,
    json: async () => ({
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
    }),
  } as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runBrowserUseTests degraded contract", () => {
  it("throws BrowserUseDegradedError when the whole run is degraded", async () => {
    fetchMock.mockResolvedValueOnce(
      mcpResponse({
        url: "http://sandbox:3000",
        degraded: true,
        reason: "navigation agent could not drive the browser",
        total: 3,
        passed: 0,
        failed: 0,
        results: [],
      }),
    );

    await expect(runBrowserUseTests("http://sandbox:3000", ["a", "b", "c"])).rejects.toThrow(
      BrowserUseDegradedError,
    );
  });

  it("maps a degraded step to not-passed with its reason", async () => {
    fetchMock.mockResolvedValueOnce(
      mcpResponse({
        url: "http://sandbox:3000",
        total: 2,
        passed: 1,
        failed: 0,
        degraded_steps: 1,
        results: [
          { test: "t1", status: "pass", detail: "ok" },
          { test: "t2", status: "degraded", detail: "agent could not drive the browser: aborted" },
        ],
      }),
    );

    const steps = await runBrowserUseTests("http://sandbox:3000", ["t1", "t2"]);
    expect(steps[0]!.passed).toBe(true);
    expect(steps[1]!.passed).toBe(false);
    expect(steps[1]!.error).toContain("could not drive the browser");
  });
});

describe("evaluatePage degraded contract", () => {
  it("throws when navigation is degraded (the live-incident shape)", async () => {
    fetchMock
      .mockResolvedValueOnce(
        mcpResponse({ session_id: "abc", status: "degraded", degraded: true, reason: "browser state unavailable" }),
      )
      // browse_close in the finally block
      .mockResolvedValue(mcpResponse({ status: "closed" }));

    await expect(evaluatePage("http://localhost:3000/login")).rejects.toThrow(BrowserUseDegradedError);
  });

  it("throws when extraction is degraded instead of returning empty findings", async () => {
    fetchMock
      .mockResolvedValueOnce(mcpResponse({ session_id: "abc", status: "navigated", url: "http://x" }))
      .mockResolvedValueOnce(
        mcpResponse({ session_id: "abc", status: "degraded", degraded: true, reason: "agent stopped before completing" }),
      )
      .mockResolvedValue(mcpResponse({ status: "closed" }));

    await expect(evaluatePage("http://x")).rejects.toThrow(BrowserUseDegradedError);
  });

  it("still returns findings on a healthy run", async () => {
    fetchMock
      .mockResolvedValueOnce(mcpResponse({ session_id: "abc", status: "navigated", url: "http://x" }))
      .mockResolvedValueOnce(
        mcpResponse({ session_id: "abc", status: "completed", data: JSON.stringify([{ issue: "low contrast" }]) }),
      )
      .mockResolvedValueOnce(mcpResponse({ session_id: "abc", screenshot_base64: "iVBOR" }))
      .mockResolvedValue(mcpResponse({ status: "closed" }));

    const result = await evaluatePage("http://x");
    expect(result.findings).toHaveLength(1);
    expect(result.screenshot).toBe("iVBOR");
  });
});
