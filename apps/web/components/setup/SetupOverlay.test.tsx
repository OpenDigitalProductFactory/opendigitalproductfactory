// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { markStepTriggered } = vi.hoisted(() => ({ markStepTriggered: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/workspace",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/actions/setup-progress", () => ({
  advanceStep: vi.fn(),
  skipStep: vi.fn(),
  pauseSetup: vi.fn(),
  completeSetup: vi.fn(),
  markStepTriggered,
}));

import { buildStepTrigger, SetupOverlay } from "./SetupOverlay";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

describe("SetupOverlay COO handoff", () => {
  it("keeps the naming explanation honest and includes the selected presentation in the final handoff", () => {
    expect(buildStepTrigger("meet-your-coo", {})).toContain("Onboarding COO guiding setup is distinct from the standing AI COO");
    const final = buildStepTrigger("workspace", { cooConversationalName: "Number Two" });
    expect(final).toContain("Number Two · AI COO");
    expect(final).toContain("does not change the coworker's AI identity, permissions, authority, or the owner's accountability");
  });

  it("routes real-page setup guidance to the distinct Onboarding COO thread", () => {
    vi.useFakeTimers();
    const details: unknown[] = [];
    const handler = (event: Event) => details.push((event as CustomEvent).detail);
    document.addEventListener("open-agent-panel", handler);

    render(<SetupOverlay
      progressId="progress-1"
      currentStep="meet-your-coo"
      steps={{ "meet-your-coo": "pending", workspace: "pending" }}
      setupContext={{}}
      triggeredSteps={[]}
    />);
    act(() => vi.advanceTimersByTime(300));

    expect(details).toHaveLength(1);
    expect(details[0]).toEqual(expect.objectContaining({ routeContext: "/setup" }));
    expect(markStepTriggered).toHaveBeenCalledWith("progress-1", "meet-your-coo");
    document.removeEventListener("open-agent-panel", handler);
  });
});
