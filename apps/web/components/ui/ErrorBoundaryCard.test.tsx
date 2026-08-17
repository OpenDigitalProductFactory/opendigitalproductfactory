// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ErrorBoundaryCard } from "./ErrorBoundaryCard";

function makeError(digest?: string): Error & { digest?: string } {
  const e = new Error("boom") as Error & { digest?: string };
  if (digest) e.digest = digest;
  return e;
}

describe("ErrorBoundaryCard", () => {
  it("renders the title, description, and a Try again that calls reset()", () => {
    const reset = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundaryCard
        error={makeError()}
        reset={reset}
        title="Sign-in hit a problem"
        description="Trying again usually fixes it."
      />,
    );
    expect(screen.getByText("Sign-in hit a problem")).toBeInTheDocument();
    expect(screen.getByText("Trying again usually fixes it.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it("surfaces the production digest as a reference and logs it", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundaryCard
        error={makeError("abc123")}
        reset={() => {}}
        title="t"
        description="d"
      />,
    );
    expect(screen.getByText("Reference: abc123")).toBeInTheDocument();
    expect(spy).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("uses tokens only — no raw hex, no text-white", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(
      <ErrorBoundaryCard error={makeError()} reset={() => {}} title="t" description="d" />,
    );
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,6}/i);
    expect(container.innerHTML).not.toContain("text-white");
    expect(container.innerHTML).toContain("var(--dpf-");
    vi.restoreAllMocks();
  });
});
