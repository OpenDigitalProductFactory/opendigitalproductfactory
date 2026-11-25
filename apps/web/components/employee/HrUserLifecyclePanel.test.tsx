// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { namespaceMessages } from "@dpf/i18n";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({ add: vi.fn(), lifecycle: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/actions/users", () => ({ addUserPlatformRole: mocks.add, updateUserLifecycle: mocks.lifecycle }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

import { HrUserLifecyclePanel } from "./HrUserLifecyclePanel";

const users = [
  { id: "owner", email: "owner@example.test", isActive: true, isSuperuser: true, roleIds: ["HR-000"] },
];
const roles = [
  { roleId: "HR-000", name: "Executive Sponsor" },
  { roleId: "HR-200", name: "Digital Product Manager" },
];

function renderPanel(canAddRole: boolean) {
  return render(<HrUserLifecyclePanel users={users} roles={roles} canAddRole={canAddRole} />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MessagesProvider locale="en-US" messages={{ admin: namespaceMessages("en-US", "admin") }}>
        {children}
      </MessagesProvider>
    ),
  });
}

describe("HR user lifecycle role addition", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.add.mockResolvedValue({ ok: true, data: { change: "added", message: "Added Digital Product Manager." } });
  });
  afterEach(cleanup);

  it("adds the chosen role without submitting account status or replacing roles", async () => {
    renderPanel(true);
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "HR-200" } });
    fireEvent.click(screen.getByLabelText("Active user"));
    fireEvent.click(screen.getByRole("button", { name: "Add role" }));
    await waitFor(() => expect(mocks.add).toHaveBeenCalledExactlyOnceWith({ userId: "owner", roleId: "HR-200" }));
    expect(mocks.lifecycle).not.toHaveBeenCalled();
    expect(await screen.findByText("Added Digital Product Manager.")).toBeTruthy();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("hides the entry point when the human cannot manage roles", () => {
    renderPanel(false);
    expect(screen.queryByRole("button", { name: "Add role" })).toBeNull();
  });

  it("keeps a held role out of the add action", () => {
    renderPanel(true);
    expect((screen.getByRole("button", { name: "Add role" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
