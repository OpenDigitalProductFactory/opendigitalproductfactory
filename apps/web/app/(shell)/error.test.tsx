// @vitest-environment jsdom
import "@/components/build-studio/test-setup";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ShellError from "./error";

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
});
