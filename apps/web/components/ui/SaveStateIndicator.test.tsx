// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SaveStateIndicator } from "./SaveStateIndicator";
import { SHELL_TAP_TARGET_CLASS } from "@/lib/shell/shell-action-contract";

afterEach(() => cleanup());

describe("SaveStateIndicator", () => {
  it("renders a stable, empty polite live region when idle", () => {
    render(<SaveStateIndicator status="idle" />);
    const region = screen.getByRole("status", { hidden: true });
    expect(region).toHaveTextContent("");
  });

  it("announces a pending state politely", () => {
    render(<SaveStateIndicator status="pending" pendingLabel="Saving priority…" />);
    expect(screen.getByText("Saving priority…")).toBeInTheDocument();
  });

  it("announces a saved state politely", () => {
    render(<SaveStateIndicator status="saved" savedLabel="Priority saved" />);
    const status = screen.getByText("Priority saved");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("announces a failed state assertively and wires Retry/Revert", () => {
    const onRetry = vi.fn();
    const onRevert = vi.fn();
    render(
      <SaveStateIndicator
        status="failed"
        error="Couldn't save. Try again."
        onRetry={onRetry}
        onRevert={onRevert}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn't save. Try again.");

    const retry = screen.getByRole("button", { name: "Retry" });
    const revert = screen.getByRole("button", { name: "Revert" });
    expect(retry).toHaveClass(SHELL_TAP_TARGET_CLASS);
    expect(revert).toHaveClass(SHELL_TAP_TARGET_CLASS);

    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    fireEvent.click(revert);
    expect(onRevert).toHaveBeenCalledTimes(1);
  });

  it("omits Retry/Revert buttons when no handler is supplied", () => {
    render(<SaveStateIndicator status="failed" error="Nope" />);
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revert" })).not.toBeInTheDocument();
  });
});
