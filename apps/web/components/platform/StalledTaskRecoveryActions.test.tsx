// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ confirm: vi.fn(), retry: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/components/ui/Dialog", () => ({ confirmDialog: mocks.confirm, promptDialog: vi.fn() }));
vi.mock("@/lib/actions/taskrun-recovery-server-actions", () => ({ serverTaskrunRetry: mocks.retry, serverTaskrunAbandon: vi.fn(), serverTaskrunEscalate: vi.fn() }));
import { StalledTaskRecoveryActions } from "./StalledTaskRecoveryActions";
const budget = { deadlineAt: "2099-01-01T00:00:00Z", recoveryAttempt: 1 };
afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => { vi.clearAllMocks(); mocks.confirm.mockResolvedValue(true); mocks.retry.mockResolvedValue({ ok: true, data: { newTaskRunId: "TR-1" } }); });
describe("reviewer recovery confirmation", () => {
  it.each([
    [{ deadlineAt: "2000-01-01T00:00:00Z", recoveryAttempt: 1 }, "Review window expired"],
    [{ ...budget, recoveryAttempt: 3 }, "Recovery limit reached"],
    [undefined, "Recovery availability unknown"],
    [{ ...budget, recoveryAttempt: null }, "Recovery availability unknown"],
  ] as const)("explains unavailable recovery without submitting it", (reviewBudget, explanation) => {
    render(<StalledTaskRecoveryActions taskRunId="TR-1" phase={null} nativeReview reviewBudget={reviewBudget} />);
    expect(screen.getByText(explanation)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Resume review" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Resume review" }));
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.retry).not.toHaveBeenCalled();
  });
  it("updates at the deadline without requiring a refresh", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-13T00:00:00Z"));
    render(<StalledTaskRecoveryActions taskRunId="TR-1" phase={null} nativeReview reviewBudget={{ deadlineAt: "2026-09-13T00:00:01Z", recoveryAttempt: 0 }} />);
    expect((screen.getByRole("button", { name: "Resume review" }) as HTMLButtonElement).disabled).toBe(false);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText("Review window expired")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Resume review" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("does not submit if the deadline passes during confirmation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-13T00:00:00Z"));
    mocks.confirm.mockImplementation(async () => { vi.setSystemTime(new Date("2026-09-13T00:00:02Z")); return true; });
    render(<StalledTaskRecoveryActions taskRunId="TR-1" phase={null} nativeReview reviewBudget={{ deadlineAt: "2026-09-13T00:00:01Z", recoveryAttempt: 0 }} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Resume review" })); });
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(screen.getByText("Review window expired")).toBeTruthy();
  });
  it("previews replacement and sends recovery only after confirmation", async () => {
    render(<StalledTaskRecoveryActions taskRunId="TR-1" phase={null} nativeReview reviewBudget={budget} />);
    expect(screen.queryByRole("button", { name: "Abandon" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resume review" }));
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith("TR-1", { force: true }));
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("provider charge") }));
    expect((await screen.findByRole("status")).textContent).toBe("Recovery requested");
  });
  it("does not dispatch when the operator declines", async () => {
    mocks.confirm.mockResolvedValue(false);
    render(<StalledTaskRecoveryActions taskRunId="TR-1" phase={null} nativeReview reviewBudget={budget} />);
    fireEvent.click(screen.getByRole("button", { name: "Resume review" }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
    expect(mocks.retry).not.toHaveBeenCalled();
  });
  it("announces server refusals instead of displaying success", async () => {
    mocks.retry.mockResolvedValue({ ok: false, error: "Review deadline exhausted" });
    render(<StalledTaskRecoveryActions taskRunId="TR-1" phase={null} nativeReview reviewBudget={budget} />);
    fireEvent.click(screen.getByRole("button", { name: "Resume review" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Review deadline exhausted");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
