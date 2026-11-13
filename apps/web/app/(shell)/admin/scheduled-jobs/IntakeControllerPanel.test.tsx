// @vitest-environment jsdom
import { cleanup, fireEvent, render as renderView, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { namespaceMessages } from "@dpf/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import type { IntakeControllerReadiness } from "@/lib/ecosystem/intake-controller-readiness";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  becomeOwner: vi.fn(),
  commission: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("@/lib/actions/scheduled-jobs", () => ({
  loadIntakeControllerPanelAction: mocks.load,
  becomeIntakeControllerOwnerAction: mocks.becomeOwner,
  commissionIntakeControllerAction: mocks.commission,
}));
vi.mock("@/components/ui/Dialog", () => ({ confirmDialog: mocks.confirm }));

import { IntakeControllerPanel } from "./IntakeControllerPanel";

function render(node: ReactNode) {
  return renderView(node, {
    wrapper: ({ children }) => (
      <MessagesProvider locale="en-US" messages={{ admin: namespaceMessages("en-US", "admin") }}>{children}</MessagesProvider>
    ),
  });
}

const pass = (id: IntakeControllerReadiness["rows"][number]["id"]) => ({ id, status: "pass" as const, reason: null });

function readiness(overrides: Partial<IntakeControllerReadiness> = {}): IntakeControllerReadiness {
  return {
    room: { capsuleId: "WC-STANDING", status: "draft", repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory" },
    rows: [
      pass("room-found"),
      { id: "upstream-configured", status: "fail", reason: "no explicit upstream repository is configured" },
      { id: "room-repository", status: "unchecked", reason: null },
    ],
    blocking: { id: "upstream-configured", status: "fail", reason: "no explicit upstream repository is configured" },
    canCommission: false,
    viewerIsOwner: false,
    ownership: { canBecomeOwner: true, handsOverFrom: ["Issue triage coordinator"] },
    commission: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue({ ok: true, data: { readiness: readiness(), canManage: true } });
});
afterEach(cleanup);

describe("IntakeControllerPanel", () => {
  it("collapses to a summary that says intake is not commissioned", async () => {
    render(<IntakeControllerPanel />);
    expect(screen.getByText("Issue intake controller")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Not commissioned", { selector: "summary *" })).toBeTruthy());
  });

  it("lists each clause with pass, fail or not checked and the plain reason", async () => {
    render(<IntakeControllerPanel />);
    const list = await screen.findByRole("list", { name: "Commissioning checklist" });
    expect(list.querySelectorAll("li")).toHaveLength(3);
    expect(screen.getByText("Upstream GitHub repository is set")).toBeTruthy();
    expect(screen.getByText("no explicit upstream repository is configured", { selector: "li *" })).toBeTruthy();
    expect(screen.getByText("Not checked")).toBeTruthy();
  });

  it("disables Commission and names the failing clause", async () => {
    render(<IntakeControllerPanel />);
    const button = (await screen.findByRole("button", { name: "Commission" })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-describedby")).toBe("intake-controller-blocked");
    expect(screen.getByText(/Blocked by: Upstream GitHub repository is set/)).toBeTruthy();
  });

  it("commissions the room when every clause passes and refreshes the register", async () => {
    const onChanged = vi.fn();
    mocks.load.mockResolvedValue({
      ok: true, data: { canManage: true,
      readiness: readiness({ rows: [pass("room-found")], blocking: null, canCommission: true, viewerIsOwner: true,
        ownership: { canBecomeOwner: false, handsOverFrom: [] } }) },
    });
    mocks.commission.mockResolvedValue({ ok: true, data: "Issue intake commissioned to WC-STANDING." });
    render(<IntakeControllerPanel onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole("button", { name: "Commission" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("commissioned to WC-STANDING"));
    expect(mocks.commission).toHaveBeenCalledWith("WC-STANDING");
    expect(onChanged).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Become the room's owner" })).toBeNull();
  });

  it("confirms the handover before making the operator the owner", async () => {
    mocks.confirm.mockResolvedValue(true);
    mocks.becomeOwner.mockResolvedValue({ ok: true, data: "Mark now owns WC-STANDING." });
    render(<IntakeControllerPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Become the room's owner" }));
    await waitFor(() => expect(mocks.becomeOwner).toHaveBeenCalledWith("WC-STANDING"));
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("Issue triage coordinator"),
    }));
  });

  it("does nothing when the handover is cancelled", async () => {
    mocks.confirm.mockResolvedValue(false);
    render(<IntakeControllerPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Become the room's owner" }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect(mocks.becomeOwner).not.toHaveBeenCalled();
  });

  it("shows a refusal from the server as an error", async () => {
    mocks.confirm.mockResolvedValue(true);
    mocks.becomeOwner.mockResolvedValue({ ok: false, error: "Not admitted." });
    render(<IntakeControllerPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Become the room's owner" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Not admitted."));
  });

  it("shows the commissioned state with room, repository and who commissioned it", async () => {
    mocks.load.mockResolvedValue({
      ok: true, data: { canManage: true,
      readiness: readiness({
        commission: {
          workroomCapsuleId: "WC-STANDING", repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
          commissionedBy: "Mark", commissionedAt: "2026-10-20T08:00:00.000Z", holds: true, reason: null,
        },
      }) },
    });
    render(<IntakeControllerPanel />);
    expect(await screen.findByText(/WC-STANDING for OpenDigitalProductFactory\/opendigitalproductfactory, by Mark/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Commission" })).toBeNull();
  });

  it("is read-only for a viewer without platform-management authority", async () => {
    mocks.load.mockResolvedValue({ ok: true, data: { readiness: readiness(), canManage: false } });
    render(<IntakeControllerPanel />);
    await screen.findByRole("list", { name: "Commissioning checklist" });
    expect(screen.queryByRole("button", { name: "Commission" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Become the room's owner" })).toBeNull();
  });

  it("explains when no controller room exists", async () => {
    mocks.load.mockResolvedValue({ ok: true, data: { canManage: true, readiness: readiness({ room: null }) } });
    render(<IntakeControllerPanel />);
    expect(await screen.findByText(/No issue-triage room exists yet/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Commission" })).toBeNull();
  });

  it("shows a load failure with a retry", async () => {
    mocks.load.mockResolvedValueOnce({ ok: false, error: "database unavailable" });
    render(<IntakeControllerPanel />);
    expect(await screen.findByText("database unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  });
});
