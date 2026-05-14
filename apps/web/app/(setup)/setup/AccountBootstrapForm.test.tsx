// @vitest-environment jsdom
import "../../../components/build-studio/test-setup";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccountBootstrapForm } from "./AccountBootstrapForm";

const actionMocks = vi.hoisted(() => ({
  advanceStep: vi.fn(),
  createOrganization: vi.fn(),
  createOwnerAccount: vi.fn(),
  signIn: vi.fn(),
}));

const routerMocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("@/lib/actions/setup-entities", () => ({
  createOrganization: actionMocks.createOrganization,
  createOwnerAccount: actionMocks.createOwnerAccount,
}));

vi.mock("@/lib/actions/setup-progress", () => ({
  advanceStep: actionMocks.advanceStep,
}));

vi.mock("next-auth/react", () => ({
  signIn: actionMocks.signIn,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
}));

describe("AccountBootstrapForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.createOrganization.mockResolvedValue({ id: "org-1" });
    actionMocks.createOwnerAccount.mockResolvedValue({
      userId: "user-1",
      email: "owner@example.com",
    });
    actionMocks.advanceStep.mockResolvedValue({ currentStep: "ai-providers" });
    actionMocks.signIn.mockResolvedValue({
      error: undefined,
      ok: true,
      status: 200,
      url: "http://localhost:3000/platform/ai/providers",
    });
  });

  it("uses portal-relative navigation after bootstrap sign-in", async () => {
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
      expect(actionMocks.signIn).toHaveBeenCalledWith(
        "workforce",
        expect.objectContaining({
          email: "owner@example.com",
          password: "correct horse battery staple",
          redirect: false,
        }),
      );
    });
    await waitFor(() => {
      expect(routerMocks.replace).toHaveBeenCalledWith("/platform/ai/providers");
    });
    expect(routerMocks.replace).not.toHaveBeenCalledWith(
      "http://localhost:3000/platform/ai/providers",
    );
  });
});
