import { beforeEach, describe, expect, it, vi } from "vitest";

import { NEXT_SETUP_ROUTE } from "./first-run-account-bootstrap-constants";
import { bootstrapFirstRunOwner } from "./first-run-account-bootstrap";

const actionMocks = vi.hoisted(() => ({
  advanceStep: vi.fn(),
  createOrganization: vi.fn(),
  createOwnerAccount: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  signIn: actionMocks.signIn,
}));

vi.mock("./setup-entities", () => ({
  createOrganization: actionMocks.createOrganization,
  createOwnerAccount: actionMocks.createOwnerAccount,
}));

vi.mock("./setup-progress", () => ({
  advanceStep: actionMocks.advanceStep,
}));

describe("bootstrapFirstRunOwner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.createOrganization.mockResolvedValue({ id: "org-1" });
    actionMocks.createOwnerAccount.mockResolvedValue({
      userId: "user-1",
      email: "owner@example.com",
    });
    actionMocks.advanceStep.mockResolvedValue({ currentStep: "business-context" });
    actionMocks.signIn.mockResolvedValue(undefined);
  });

  it("creates first-run records and signs in through the server auth helper", async () => {
    await bootstrapFirstRunOwner("setup-1", {
      orgName: "Digital Product Factory Scratch",
      email: "owner@example.com",
      password: "ScratchPassw0rd!",
    });

    expect(actionMocks.createOrganization).toHaveBeenCalledWith("setup-1", {
      orgName: "Digital Product Factory Scratch",
    });
    expect(actionMocks.createOwnerAccount).toHaveBeenCalledWith("setup-1", {
      name: "Digital Product Factory Scratch",
      email: "owner@example.com",
      password: "ScratchPassw0rd!",
    });
    expect(actionMocks.advanceStep).toHaveBeenCalledWith("setup-1", {
      orgName: "Digital Product Factory Scratch",
    });
    expect(actionMocks.signIn).toHaveBeenCalledWith("workforce", {
      email: "owner@example.com",
      password: "ScratchPassw0rd!",
      redirectTo: NEXT_SETUP_ROUTE,
    });
  });
});
