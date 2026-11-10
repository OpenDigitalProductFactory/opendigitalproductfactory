// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { UpgradeHold, probeQuiescence } from "./UpgradeHold";

function fetchReturning(bodies: Array<Record<string, unknown>>) {
  let i = 0;
  return vi.fn(async () => {
    const body = bodies[Math.min(i, bodies.length - 1)];
    i += 1;
    return { json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("UpgradeHold (BI-57D91FF0)", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); refresh.mockReset(); });

  it("tells the person what is happening and that nothing is needed from them", () => {
    render(<UpgradeHold runId="QR-2026-09-18-xq990684" fetchImpl={fetchReturning([{ level: "draining" }])} />);
    expect(screen.getByRole("status").textContent).toMatch(/upgrading itself/);
    expect(screen.getByText(/Nothing to do/)).toBeTruthy();
    expect(screen.getByText(/QR-2026-09-18-xq990684/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("probes on the server's cadence and resumes by itself once the level is normal", async () => {
    vi.useFakeTimers();
    const fetchImpl = fetchReturning([{ level: "draining", runId: "QR-1" }, { level: "normal", runId: null }]);
    render(<UpgradeHold retryAfterSeconds={5} fetchImpl={fetchImpl} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByText(/QR-1/)).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("a failed probe is unknown, never a crash", async () => {
    const failing = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await probeQuiescence(failing)).toEqual({ level: "unknown", runId: null });
  });
});
