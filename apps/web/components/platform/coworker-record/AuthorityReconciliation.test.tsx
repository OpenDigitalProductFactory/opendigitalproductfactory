// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ preview: vi.fn(), approve: vi.fn(), confirm: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/components/ui/Dialog", () => ({ confirmDialog: mocks.confirm }));
vi.mock("@/lib/actions/coworker-grants", () => ({ previewCoworkerPermissions: mocks.preview, approveCoworkerPermissions: mocks.approve }));
import { AuthorityReconciliation } from "./AuthorityReconciliation";
import { withMessages } from "@/test-support/with-messages";
beforeEach(() => {
  cleanup(); vi.resetAllMocks();
  mocks.preview.mockResolvedValue({ canonicalAgentId: "AGT-EXT-CODEX", aliasAgentId: "external-codex", digest: "snapshot",
    differences: [{ grantKey: "release_plan_read", canonical: "revoked", alias: "granted" }] });
  mocks.confirm.mockResolvedValue(true); mocks.approve.mockResolvedValue({ ok: true });
});
describe("administrator permission review", () => {
  it("requires a choice and confirmation before submitting the exact preview", async () => {
    render(withMessages(<AuthorityReconciliation agentId="AGT-EXT-CODEX" />));
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review legacy permissions" }));
    const select = await screen.findByRole("combobox");
    const approve = screen.getByRole("button", { name: "Approve choices" });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(select, { target: { value: "alias" } });
    fireEvent.click(approve);
    await waitFor(() => expect(mocks.approve).toHaveBeenCalledWith({ coworkerRef: "AGT-EXT-CODEX", digest: "snapshot",
      choices: [{ grantKey: "release_plan_read", source: "alias" }] }));
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    await screen.findByRole("status");
  });
  it("cancelled confirmation makes no change", async () => {
    mocks.confirm.mockResolvedValue(false);
    render(withMessages(<AuthorityReconciliation agentId="AGT-EXT-CODEX" />));
    fireEvent.click(screen.getByRole("button", { name: "Review legacy permissions" }));
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "canonical" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve choices" }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect(mocks.approve).not.toHaveBeenCalled();
  });
  it("shows a stale-state refusal and retains the preview for re-review", async () => {
    mocks.approve.mockResolvedValue({ ok: false, error: "Permissions changed after preview. Review a fresh preview." });
    render(withMessages(<AuthorityReconciliation agentId="AGT-EXT-CODEX" />));
    fireEvent.click(screen.getByRole("button", { name: "Review legacy permissions" }));
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "alias" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve choices" }));
    expect((await screen.findByRole("alert")).textContent).toContain("changed after preview");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
