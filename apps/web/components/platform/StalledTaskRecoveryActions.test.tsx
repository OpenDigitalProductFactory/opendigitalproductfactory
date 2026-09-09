// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ confirm: vi.fn(), retry: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/components/ui/Dialog", () => ({ confirmDialog: mocks.confirm, promptDialog: vi.fn() }));
vi.mock("@/lib/actions/taskrun-recovery-server-actions", () => ({ serverTaskrunRetry: mocks.retry, serverTaskrunAbandon: vi.fn(), serverTaskrunEscalate: vi.fn() }));
import { StalledTaskRecoveryActions } from "./StalledTaskRecoveryActions";
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); mocks.confirm.mockResolvedValue(true); mocks.retry.mockResolvedValue({ ok: true, data: { newTaskRunId: "TR-1" } }); });
describe("reviewer recovery confirmation", () => {
  it("previews replacement and sends recovery only after confirmation", async () => {
    render(<StalledTaskRecoveryActions taskRunId="TR-1" phase={null} nativeReview />);
    expect(screen.queryByRole("button", { name: "Abandon" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resume review" }));
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith("TR-1", { force: true }));
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("provider charge") }));
    expect((await screen.findByRole("status")).textContent).toBe("Recovery requested");
  });
  it("does not dispatch when the operator declines", async () => {
    mocks.confirm.mockResolvedValue(false);
    render(<StalledTaskRecoveryActions taskRunId="TR-1" phase={null} nativeReview />);
    fireEvent.click(screen.getByRole("button", { name: "Resume review" }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
    expect(mocks.retry).not.toHaveBeenCalled();
  });
  it("announces server refusals instead of displaying success", async () => {
    mocks.retry.mockResolvedValue({ ok: false, error: "Review deadline exhausted" });
    render(<StalledTaskRecoveryActions taskRunId="TR-1" phase={null} nativeReview />);
    fireEvent.click(screen.getByRole("button", { name: "Resume review" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Review deadline exhausted");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
