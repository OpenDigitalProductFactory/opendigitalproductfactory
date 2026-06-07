// @vitest-environment jsdom
import "@/components/build-studio/test-setup";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ShellError from "./error";

function crashError(digest?: string): Error & { digest?: string } {
  const e = new Error("Cannot read properties of undefined (reading 'split')") as Error & { digest?: string };
  if (digest) e.digest = digest;
  return e;
}

describe("ShellError", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/portal/build");
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ reportId: "QR-123" }),
        }),
      ),
    );
  });

  it("shows diagnostic context outside the feedback textarea", () => {
    render(
      <ShellError
        error={new Error("Cannot read properties of undefined (reading 'split')")}
        reset={() => undefined}
      />,
    );

    expect(screen.getByText("/portal/build")).toBeInTheDocument();
    expect(screen.getByText("Cannot read properties of undefined (reading 'split')")).toBeInTheDocument();

    const feedback = screen.getByLabelText("What were you doing when this happened?");
    expect(feedback).toHaveValue("");
    expect(feedback).toHaveAttribute("rows", "4");
  });

  // BI-B4F401B3: the AI-client diagnostic prompt is the headline behavior.
  it("renders a copy-paste AI diagnostic prompt with route, digest, and investigation steps", () => {
    render(<ShellError error={crashError("digest-xyz-123")} reset={() => undefined} />);

    const prompt = screen.getByText(/You are debugging a production crash/);
    expect(prompt.textContent).toContain("Route: /portal/build");
    expect(prompt.textContent).toContain("Error digest: digest-xyz-123");
    // The checklist must steer the AI client to the real log/migration evidence,
    // not a guessed cause.
    expect(prompt.textContent).toContain("prisma migrate status");
    expect(prompt.textContent).toContain("server logs");
  });

  it("copies the prompt to the clipboard and confirms, with an accessible label", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(<ShellError error={crashError("digest-xyz-123")} reset={() => undefined} />);

    // Button carries the descriptive aria-label and enables once the auto-report resolves.
    const btn = await screen.findByRole("button", { name: "Copy AI diagnostic prompt to clipboard" });
    await waitFor(() => expect(btn).not.toBeDisabled());

    fireEvent.click(btn);

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]?.[0]).toContain("Error digest: digest-xyz-123");
    expect(await screen.findByText("Copied!")).toBeInTheDocument();
    // Screen-reader confirmation is announced.
    expect(screen.getByText("Diagnostic prompt copied to clipboard")).toBeInTheDocument();
  });
});
