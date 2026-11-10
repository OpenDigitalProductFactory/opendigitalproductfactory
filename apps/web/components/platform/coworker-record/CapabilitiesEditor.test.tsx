// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ grant: vi.fn(), revoke: vi.fn(), skill: vi.fn(), confirm: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/components/ui/Dialog", () => ({ confirmDialog: mocks.confirm }));
vi.mock("@/lib/actions/coworker-grants", () => ({ grantCoworkerTool: mocks.grant, revokeCoworkerTool: mocks.revoke,
  grantCoworkerSkill: mocks.skill, revokeCoworkerSkill: mocks.skill, previewCoworkerPermissions: vi.fn(), approveCoworkerPermissions: vi.fn() }));
import { CapabilitiesEditor } from "./CapabilitiesEditor";
import { withMessages } from "@/test-support/with-messages";
const props = { agentCuid: "canonical-cuid", agentBusinessId: "AGT-EXT-CODEX", skillAgentBusinessId: "external-codex",
  slugId: "external-codex", heldGrants: ["registry_read"], allGrantKeys: ["registry_read", "release_plan_read"],
  assignedSkills: [], catalogSkills: [], canWrite: true, permissionPreview: null };
beforeEach(() => { cleanup(); vi.resetAllMocks(); mocks.grant.mockResolvedValue({ ok: true }); mocks.revoke.mockResolvedValue({ ok: true }); mocks.confirm.mockResolvedValue(true); });
describe("one saved permissions editor", () => {
  it("has no legacy setup for fresh/completed installs and explains effective access", () => {
    render(withMessages(<CapabilitiesEditor {...props} />));
    expect(screen.getByRole("heading", { name: "Saved permissions" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Review permission/ })).toBeNull();
    expect(screen.getByText(/signed-in person's permissions, and the work room/)).toBeVisible();
  });
  it("searches and adds to the canonical owner and announces persistence", async () => {
    render(withMessages(<CapabilitiesEditor {...props} />));
    fireEvent.change(screen.getByLabelText("Add permission"), { target: { value: "release plan read" } });
    fireEvent.click(screen.getByRole("button", { name: "Add permission" }));
    await waitFor(() => expect(mocks.grant).toHaveBeenCalledWith("canonical-cuid", "release_plan_read", "AGT-EXT-CODEX", "external-codex"));
    expect((await screen.findByText(/^Permissions saved\./)).closest('[role="status"]')).not.toBeNull();
    expect(mocks.refresh).toHaveBeenCalled();
  });
  it("confirms removal and revalidates the same canonical owner", async () => {
    render(withMessages(<CapabilitiesEditor {...props} />));
    fireEvent.click(screen.getByRole("button", { name: "Revoke registry_read" }));
    await waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith("canonical-cuid", "registry_read", "AGT-EXT-CODEX", "external-codex"));
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect((await screen.findByText(/^Permissions saved\./)).closest('[role="status"]')).not.toBeNull();
  });
  it("preserves a denied mutation without false saved feedback", async () => {
    mocks.revoke.mockResolvedValue({ ok: false, error: "Administrator authority required" });
    render(withMessages(<CapabilitiesEditor {...props} />));
    fireEvent.click(screen.getByRole("button", { name: "Revoke registry_read" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Administrator authority required");
    expect(screen.queryByText(/Permissions saved/)).toBeNull();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("read-only principals have no mutation or conflict controls", () => {
    render(withMessages(<CapabilitiesEditor {...props} canWrite={false} />));
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
