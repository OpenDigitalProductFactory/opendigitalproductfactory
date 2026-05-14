// @vitest-environment jsdom
import "../../../components/build-studio/test-setup";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccountBootstrapForm } from "./AccountBootstrapForm";

const actionMocks = vi.hoisted(() => ({
  bootstrapFirstRunOwner: vi.fn(),
}));

vi.mock("@/lib/actions/first-run-account-bootstrap", () => ({
  bootstrapFirstRunOwner: actionMocks.bootstrapFirstRunOwner,
}));

describe("AccountBootstrapForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.bootstrapFirstRunOwner.mockResolvedValue(undefined);
  });

  it("submits first-run account bootstrap through one server action", async () => {
    const { container } = render(<AccountBootstrapForm setupId="setup-1" />);

    fireEvent.change(screen.getByPlaceholderText(/digital product factory/i), {
      target: { value: "Digital Product Factory Scratch" },
    });
    fireEvent.change(container.querySelector('input[type="email"]')!, {
      target: { value: "owner@example.com" },
    });
    fireEvent.change(container.querySelector('input[type="password"]')!, {
      target: { value: "correct horse battery staple" },
    });

    fireEvent.click(screen.getByRole("button", { name: /get started/i }));

    await waitFor(() => {
      expect(actionMocks.bootstrapFirstRunOwner).toHaveBeenCalledWith("setup-1", {
        orgName: "Digital Product Factory Scratch",
          email: "owner@example.com",
          password: "correct horse battery staple",
      });
    });
  });
});
