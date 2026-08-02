// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhaseRemediationActions } from "./PhaseRemediationActions";

const refresh = vi.fn();
const toggleProviderStatus = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/lib/actions/ai-providers", () => ({
  toggleProviderStatus: (...args: unknown[]) => toggleProviderStatus(...args),
}));

describe("PhaseRemediationActions", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    refresh.mockReset();
    toggleProviderStatus.mockReset().mockResolvedValue({});
  });

  it("marks the governed one-click provider action and reports completion", async () => {
    render(
      <PhaseRemediationActions
        candidates={[
          {
            providerId: "local-tools",
            displayName: "Local Tools",
            action: "enable",
            actionLabel: "Enable provider",
            oneClick: true,
            satisfies: ["tool use", "internal sensitivity"],
            note: null,
          },
        ]}
      />,
    );

    const action = screen.getByRole("button", { name: "Enable provider" });
    expect(action.hasAttribute("data-dpf-primary-action")).toBe(true);
    expect(action.className).toContain("dpf-tap-target");
    fireEvent.click(action);

    await waitFor(() => expect(toggleProviderStatus).toHaveBeenCalledWith("local-tools"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("links credential-gated candidates to the exact provider setup page", () => {
    render(
      <PhaseRemediationActions
        candidates={[
          {
            providerId: "anthropic",
            displayName: "Anthropic",
            action: "connect_credentials",
            actionLabel: "Connect & enable",
            oneClick: false,
            satisfies: ["tool use"],
            note: "Needs credentials you must supply.",
          },
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: "Connect & enable" }).getAttribute("href")).toBe(
      "/platform/ai/providers/anthropic",
    );
    expect(screen.getByText("Needs credentials you must supply.")).toBeTruthy();
  });
});
