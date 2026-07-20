// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SETUP_STEPS } from "@/lib/actions/setup-constants";
import { SetupProgressBar } from "./SetupProgressBar";

afterEach(cleanup);

describe("SetupProgressBar", () => {
  it("names the setup journey and exposes current, completed, and skipped status without color", () => {
    render(<SetupProgressBar
      currentStep="ai-providers"
      steps={{ "business-context": "completed", "ai-providers": "pending", branding: "skipped" }}
    />);

    expect(screen.getByRole("navigation", { name: "Setup progress" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Your Business, completed/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /AI Providers, current, pending/ }).getAttribute("aria-current")).toBe("step");
    expect(screen.getByRole("button", { name: /Branding, skipped/ })).toBeTruthy();
  });

  it("keeps all steps in a horizontally contained mobile navigation and preserves button activation", () => {
    const onStepClick = vi.fn();
    render(<SetupProgressBar currentStep="ai-providers" steps={{}} onStepClick={onStepClick} />);

    const nav = screen.getByRole("navigation", { name: "Setup progress" });
    expect(nav.className).toContain("overflow-x-auto");
    expect(screen.getAllByRole("button")).toHaveLength(SETUP_STEPS.length);
    fireEvent.click(screen.getByRole("button", { name: /AI Providers, current/ }));
    expect(onStepClick).toHaveBeenCalledWith("ai-providers");
  });
});
