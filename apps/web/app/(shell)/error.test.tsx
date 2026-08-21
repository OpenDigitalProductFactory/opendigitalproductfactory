// @vitest-environment jsdom
import "@/test-setup";
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

  // BI-B4F401B3: the AI-client diagnostic prompt is collapsed behind a disclosure
  // so the primary CTA (description + escalation) is first for non-technical users.
  it("renders a copy-paste AI diagnostic prompt with route, digest, and investigation steps after expanding the diagnostic section", () => {
    render(<ShellError error={crashError("digest-xyz-123")} reset={() => undefined} />);

    // The developer diagnostic section is collapsed by default; expand it first.
    fireEvent.click(screen.getByRole("button", { name: /Developer diagnostic/ }));

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

    // Expand the developer diagnostic section before looking for the copy button.
    fireEvent.click(screen.getByRole("button", { name: /Developer diagnostic/ }));

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

  // BI-D22D4607: stale-tab deployment skew auto-recovers with one reload
  // instead of the crash screen + a critical auto-report.
  describe("deployment skew auto-reload", () => {
    const skewError = () =>
      new Error("An unexpected response was received from the server.");

    let reload: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      sessionStorage.clear();
      reload = vi.fn();
      // jsdom's location.reload throws "Not implemented" — replace it.
      Object.defineProperty(window, "location", {
        value: { ...window.location, pathname: "/portal/build", reload },
        writable: true,
        configurable: true,
      });
    });

    it("reloads once, shows the update notice, and skips the auto-report", async () => {
      render(<ShellError error={skewError()} reset={() => undefined} />);

      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      expect(screen.getByText("The portal was updated")).toBeInTheDocument();
      expect(screen.getByText(/Refreshing this page to the latest version/)).toBeInTheDocument();
      expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
      // The reload-loop guard is stamped…
      expect(sessionStorage.getItem("dpf-skew-reload-at")).not.toBeNull();
      // …and no critical runtime_error report is filed for routine skew.
      expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(
        "/api/quality/report",
        expect.anything(),
      );
    });

    it("falls through to the crash screen when a reload was already tried", async () => {
      // A recent stamp means the previous reload did not fix it — real problem.
      sessionStorage.setItem("dpf-skew-reload-at", String(Date.now() - 5_000));

      render(<ShellError error={skewError()} reset={() => undefined} />);

      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
      expect(screen.getByText(/open across a platform update/)).toBeInTheDocument();
      expect(reload).not.toHaveBeenCalled();
      // This time it IS reportable — the auto-report fires.
      await waitFor(() =>
        expect(vi.mocked(fetch)).toHaveBeenCalledWith(
          "/api/quality/report",
          expect.anything(),
        ),
      );
    });

    it("never auto-reloads for ordinary crashes", async () => {
      render(
        <ShellError
          error={new Error("Cannot read properties of undefined (reading 'split')")}
          reset={() => undefined}
        />,
      );

      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
      expect(screen.queryByText(/open across a platform update/)).not.toBeInTheDocument();
      await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
      expect(reload).not.toHaveBeenCalled();
    });
  });
});
