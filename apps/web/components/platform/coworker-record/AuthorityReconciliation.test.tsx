// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ preview: vi.fn(), approve: vi.fn(), confirm: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/components/ui/Dialog", () => ({ confirmDialog: mocks.confirm }));
vi.mock("@/lib/actions/coworker-grants", () => ({ previewCoworkerPermissions: mocks.preview, approveCoworkerPermissions: mocks.approve }));
import { AuthorityReconciliation } from "./AuthorityReconciliation";
import { withMessages } from "@/test-support/with-messages";
const initialPreview = { canonicalAgentId: "AGT-EXT-CODEX", aliasAgentId: "external-codex", digest: "snapshot",
  differences: [{ grantKey: "release_plan_read", canonical: "revoked" as const, alias: "granted" as const }] };
beforeEach(() => {
  cleanup(); vi.resetAllMocks();
  mocks.preview.mockResolvedValue({ canonicalAgentId: "AGT-EXT-CODEX", aliasAgentId: "external-codex", digest: "snapshot",
    differences: [{ grantKey: "release_plan_read", canonical: "revoked", alias: "granted" }] });
  mocks.confirm.mockResolvedValue(true); mocks.approve.mockResolvedValue({ ok: true });
});
async function reviewReady() {
  fireEvent.click(screen.getByRole("button", { name: "Review permission differences" }));
  const choice = await screen.findByRole("button", { name: "Keep current permissions for all" });
  // Preview content can mount while its transition still disables controls.
  // Exercise the same enabled control a person can actually use.
  await waitFor(() => expect(choice).toBeEnabled());
}

describe("administrator permission review", () => {
  it("requires a choice and confirmation before submitting the exact preview", async () => {
    render(withMessages(<AuthorityReconciliation agentId="AGT-EXT-CODEX" initialPreview={initialPreview} />));
    expect(screen.queryByRole("combobox")).toBeNull();
    await reviewReady();
    fireEvent.click(await screen.findByText("Review individually"));
    const select = await screen.findByRole("combobox");
    const approve = screen.getByRole("button", { name: "Approve choices" });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(select, { target: { value: "alias" } });
    fireEvent.click(approve);
    await waitFor(() => expect(mocks.approve).toHaveBeenCalledWith({ coworkerRef: "AGT-EXT-CODEX", digest: "snapshot",
      choices: [{ grantKey: "release_plan_read", source: "alias" }] }));
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    await screen.findByText(/Previous permission authority retired/);
    expect(screen.queryByRole("button", { name: "Review permission differences" })).toBeNull();
  });
  it("cancelled confirmation makes no change", async () => {
    mocks.confirm.mockResolvedValue(false);
    render(withMessages(<AuthorityReconciliation agentId="AGT-EXT-CODEX" initialPreview={initialPreview} />));
    await reviewReady();
    fireEvent.click(await screen.findByText("Review individually"));
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "canonical" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve choices" }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect(mocks.approve).not.toHaveBeenCalled();
  });
  it("shows a stale-state refusal and retains the preview for re-review", async () => {
    mocks.approve.mockResolvedValue({ ok: false, error: "Permissions changed after preview. Review a fresh preview." });
    render(withMessages(<AuthorityReconciliation agentId="AGT-EXT-CODEX" initialPreview={initialPreview} />));
    await reviewReady();
    fireEvent.click(await screen.findByText("Review individually"));
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "alias" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve choices" }));
    expect((await screen.findByRole("alert")).textContent).toContain("changed after preview");
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Approve choices" })).toBeNull();
  });
  it("renders no setup or review controls for fresh and reconciled installs", () => {
    const { container } = render(withMessages(<AuthorityReconciliation agentId="AGT-EXT-CODEX" initialPreview={{ ...initialPreview, differences: [] }} />));
    expect(container.textContent).toBe("");
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("selects a bulk choice with individual overrides on the exact snapshot", async () => {
    const two = { ...initialPreview, differences: [...initialPreview.differences,
      { grantKey: "inventory_read", canonical: "absent" as const, alias: "granted" as const }] };
    mocks.preview.mockResolvedValue(two);
    render(withMessages(<AuthorityReconciliation agentId="AGT-EXT-CODEX" initialPreview={two} />));
    await reviewReady();
    fireEvent.click(await screen.findByRole("button", { name: "Keep current permissions for all" }));
    expect(screen.getByText("2 of 2 choices selected")).toBeVisible();
    fireEvent.click(screen.getByText("Review individually"));
    fireEvent.change(screen.getByRole("combobox", { name: "Permission source for inventory_read" }), { target: { value: "alias" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve choices" }));
    await waitFor(() => expect(mocks.approve).toHaveBeenCalledWith({ coworkerRef: "AGT-EXT-CODEX", digest: "snapshot",
      choices: [{ grantKey: "release_plan_read", source: "canonical" }, { grantKey: "inventory_read", source: "alias" }] }));
  });
  it("shows unavailable review honestly and can recover", async () => {
    render(withMessages(<AuthorityReconciliation agentId="AGT-EXT-CODEX" initialPreview={null} loadError="Review unavailable" />));
    expect(screen.getByRole("alert")).toHaveTextContent("Review unavailable");
    await reviewReady();
    expect(await screen.findByRole("button", { name: "Keep current permissions for all" })).toBeVisible();
  });
  it("shows a refreshed preview failure and discards the previous choices", async () => {
    const { rerender } = render(withMessages(<AuthorityReconciliation agentId="AGT-EXT-CODEX" initialPreview={initialPreview} />));
    await reviewReady();
    fireEvent.click(screen.getByRole("button", { name: "Keep current permissions for all" }));
    rerender(withMessages(<AuthorityReconciliation agentId="AGT-EXT-CODEX" initialPreview={null} loadError="Preview failed after refresh" />));
    expect(screen.getByRole("alert")).toHaveTextContent("Preview failed after refresh");
    expect(screen.queryByRole("button", { name: "Approve choices" })).toBeNull();
    expect(screen.getByRole("button", { name: "Review permission differences" })).toBeEnabled();
    expect(mocks.approve).not.toHaveBeenCalled();
  });
  it("does not assert a permission conflict when the preview is unavailable", () => {
    render(withMessages(<AuthorityReconciliation agentId="AGT-EXT-CODEX" initialPreview={null} loadError="Preview failed" />));
    expect(screen.getByRole("alert")).toHaveTextContent("Preview failed");
    expect(screen.queryByText(/A previous record has different permissions/)).toBeNull();
    expect(screen.getByText("Preview unavailable.")).toBeVisible();
  });
  it("clears a prior loader error when refreshed props confirm no conflict", () => {
    const { rerender, container } = render(withMessages(<AuthorityReconciliation agentId="AGT-EXT-CODEX" initialPreview={null} loadError="Preview failed" />));
    expect(screen.getByRole("alert")).toHaveTextContent("Preview failed");
    rerender(withMessages(<AuthorityReconciliation agentId="AGT-EXT-CODEX" initialPreview={{ ...initialPreview, differences: [] }} loadError={null} />));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.textContent).toBe("");
  });
  it("invalidates displayed choices when server props refresh to a different digest", async () => {
    const { rerender } = render(withMessages(<AuthorityReconciliation agentId="AGT-EXT-CODEX" initialPreview={initialPreview} />));
    await reviewReady();
    fireEvent.click(await screen.findByRole("button", { name: "Use previous permissions for all" }));
    rerender(withMessages(<AuthorityReconciliation agentId="AGT-EXT-CODEX" initialPreview={{ ...initialPreview, digest: "updated" }} />));
    expect(screen.queryByRole("button", { name: "Approve choices" })).toBeNull();
  });
});
