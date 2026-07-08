// @vitest-environment jsdom
//
// BI-F381D902: the global sentinel must surface a Reload prompt for a stale tab
// even when the failure is SWALLOWED (no error bubbles to the crash boundary),
// and must stay silent when the tab is current.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { DeploymentSkewBanner } from "./DeploymentSkewBanner";

function setBoot(identity: { version: string; bundleHash: string } | null) {
  if (identity) {
    (window as { __DPF_BOOT__?: unknown }).__DPF_BOOT__ = identity;
  } else {
    delete (window as { __DPF_BOOT__?: unknown }).__DPF_BOOT__;
  }
}

function mockServed(identity: { version: string; bundleHash: string }) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => identity });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Fire a tab-refocus so the proactive boot-vs-served check runs immediately
 *  (jsdom reports visibilityState "visible" by default). */
function refocus() {
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("DeploymentSkewBanner", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setBoot(null);
    cleanup();
  });

  it("stays hidden when the running deployment matches the tab (no false positive)", async () => {
    setBoot({ version: "1", bundleHash: "aaa" });
    const fetchMock = mockServed({ version: "1", bundleHash: "aaa" });
    render(<DeploymentSkewBanner />);

    refocus();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId("deployment-skew-banner")).toBeNull();
  });

  it("shows the reload prompt when the served bundle differs — the SWALLOWED case", async () => {
    setBoot({ version: "1", bundleHash: "aaa" });
    mockServed({ version: "2", bundleHash: "bbb" });
    render(<DeploymentSkewBanner />);

    // No error was thrown anywhere; detection is purely the proactive
    // boot-vs-served comparison.
    refocus();
    await waitFor(() => expect(screen.getByTestId("deployment-skew-banner")).toBeTruthy());
    expect(screen.getByRole("button", { name: /reload to continue/i })).toBeTruthy();
  });

  it("shows the reload prompt on a window-level skew error (the non-swallowed case)", async () => {
    setBoot({ version: "1", bundleHash: "aaa" });
    mockServed({ version: "1", bundleHash: "aaa" }); // identity matches; the error is the trigger
    render(<DeploymentSkewBanner />);

    act(() => {
      window.dispatchEvent(
        new ErrorEvent("error", {
          message:
            'Failed to find Server Action "abc". This request might be from an older or newer deployment.',
        }),
      );
    });

    await waitFor(() => expect(screen.getByTestId("deployment-skew-banner")).toBeTruthy());
  });

  it("ignores an ordinary (non-skew) window error", async () => {
    setBoot({ version: "1", bundleHash: "aaa" });
    const fetchMock = mockServed({ version: "1", bundleHash: "aaa" });
    render(<DeploymentSkewBanner />);

    act(() => {
      window.dispatchEvent(new ErrorEvent("error", { message: "Cannot read properties of undefined" }));
    });
    refocus();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId("deployment-skew-banner")).toBeNull();
  });
});
