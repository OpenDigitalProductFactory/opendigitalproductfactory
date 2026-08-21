// @vitest-environment jsdom
import "@/test-setup";
import { render, screen } from "@testing-library/react";
import { act } from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import {
  AccountBootstrapSubmitButton,
  FIRST_RUN_PENDING_RECOVERY_DELAY_MS,
} from "./AccountBootstrapSubmitButton";

let formPending = false;

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return {
    ...actual,
    useFormStatus: () => ({ pending: formPending }),
  };
});

describe("AccountBootstrapSubmitButton", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    formPending = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the recovery link hidden while the form is idle", () => {
    render(<AccountBootstrapSubmitButton />);

    expect(screen.getByRole("button", { name: "Get Started" })).toBeEnabled();
    expect(screen.queryByRole("link", { name: "Continue" })).not.toBeInTheDocument();
  });

  it("offers a continue link if first-run setup remains pending", () => {
    formPending = true;
    render(<AccountBootstrapSubmitButton />);

    expect(screen.queryByRole("link", { name: "Continue" })).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(FIRST_RUN_PENDING_RECOVERY_DELAY_MS);
    });

    const link = screen.getByRole("link", { name: "Continue" });
    expect(link).toHaveAttribute("href", "/setup");
  });
});
