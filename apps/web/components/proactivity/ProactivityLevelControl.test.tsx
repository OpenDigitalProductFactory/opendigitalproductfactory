// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProactivityLevelControl } from "./ProactivityLevelControl";

afterEach(() => {
  cleanup();
});

describe("ProactivityLevelControl", () => {
  it("renders compact gauge, label, and current level", () => {
    render(<ProactivityLevelControl value="balanced" onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Proactivity balanced/i })).toBeTruthy();
    expect(screen.getByText("Proactivity")).toBeTruthy();
    expect(screen.getByText("Balanced")).toBeTruthy();
  });

  it("lets the operator choose Assertive without relying on color alone", () => {
    const onChange = vi.fn();
    render(<ProactivityLevelControl value="balanced" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /Proactivity balanced/i }));
    fireEvent.click(screen.getByRole("button", { name: /Assertive/i }));

    expect(onChange).toHaveBeenCalledWith("assertive");
  });
});
