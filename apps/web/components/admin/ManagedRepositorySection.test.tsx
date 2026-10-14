// @vitest-environment jsdom
//
// Managed repository section (BI-985F4EC9): presenter per status, explicit
// save, "Not now", device-flow login with the repository-controller purpose,
// and the polite live region.
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { namespaceMessages } from "@dpf/i18n";

vi.mock("@/lib/actions/github-device-flow", () => ({
  initiateDeviceFlow: vi.fn(),
  pollDeviceFlow: vi.fn(),
}));
vi.mock("@/lib/actions/managed-repository", () => ({
  saveManagedRepository: vi.fn(),
  checkManagedRepository: vi.fn(),
}));

import { initiateDeviceFlow, pollDeviceFlow } from "@/lib/actions/github-device-flow";
import { checkManagedRepository, saveManagedRepository } from "@/lib/actions/managed-repository";
import type { ManagedRepositoryStatus, ManagedRepositoryStatusView } from "@/lib/forge/managed-repository-access";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { ManagedRepositorySection, presentManagedRepository } from "./ManagedRepositorySection";

function render(ui: ReactElement) {
  return rtlRender(
    <MessagesProvider locale="en-US" messages={{ admin: namespaceMessages("en-US", "admin") }}>{ui}</MessagesProvider>,
  );
}

const REPO = { forge: "github" as const, owner: "acme", repo: "widgets", fullName: "acme/widgets" };

function view(status: ManagedRepositoryStatus, repository: typeof REPO | null = REPO): ManagedRepositoryStatusView {
  return { repository, status, checkedAt: "2026-10-14T10:00:00.000Z", lastAnsweredAt: status === "check-failed" ? "2026-10-14T09:00:00.000Z" : null };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("presentManagedRepository", () => {
  it.each([
    ["connected", "check", false],
    ["read-only", "connect", true],
    ["no-access", "connect", true],
    ["login-expired", "connect", true],
    ["not-connected", "connect", true],
    ["check-failed", "check", true],
  ] as const)("%s → primary %s", (status, primary, hasHint) => {
    expect(presentManagedRepository(view(status))).toEqual({ status, primary, hasHint });
  });

  it.each([
    ["connected", "Connected"],
    ["read-only", "Read only"],
    ["no-access", "No access"],
    ["login-expired", "Login expired"],
    ["not-connected", "Not connected"],
    ["check-failed", "Couldn't check"],
  ] as const)("renders the %s chip as %s, with a next step unless Connected", (status, label) => {
    render(<ManagedRepositorySection initialStatus={view(status)} suggestion="" />);
    expect(screen.getByTestId("managed-repository-status")).toHaveTextContent(label);
    expect(screen.queryByText(/managedRepository\./)).toBeNull();
  });
});

describe("ManagedRepositorySection", () => {
  it("pre-fills the suggestion without saving it, and Not now saves nothing", () => {
    render(<ManagedRepositorySection initialStatus={view("not-connected", null)} suggestion="Org/upstream" />);

    expect(screen.getByLabelText("GitHub repository")).toHaveValue("Org/upstream");
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(saveManagedRepository).not.toHaveBeenCalled();
    expect(screen.getByTestId("managed-repository-skipped")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set repository" })).toBeInTheDocument();
  });

  it("saves the typed repository, then checks it", async () => {
    vi.mocked(saveManagedRepository).mockResolvedValueOnce({ ok: true, data: { fullName: "acme/widgets" } });
    vi.mocked(checkManagedRepository).mockResolvedValueOnce({ ok: true, data: view("not-connected") });
    render(<ManagedRepositorySection initialStatus={view("not-connected", null)} suggestion="Org/upstream" />);

    fireEvent.change(screen.getByLabelText("GitHub repository"), { target: { value: "acme/widgets" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(saveManagedRepository).toHaveBeenCalledWith("acme/widgets");
    expect(checkManagedRepository).toHaveBeenCalled();
    expect(screen.getByTestId("managed-repository-row")).toHaveTextContent("acme/widgets");
    expect(screen.getByTestId("managed-repository-status")).toHaveTextContent(/not connected/i);
  });

  it("shows a save error in an alert", async () => {
    vi.mocked(saveManagedRepository).mockResolvedValueOnce({ ok: false, error: "Enter a GitHub repository as owner/name or its URL." });
    render(<ManagedRepositorySection initialStatus={view("not-connected", null)} suggestion="" />);

    fireEvent.change(screen.getByLabelText("GitHub repository"), { target: { value: "nope" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("owner/name");
  });

  it("Check again re-checks a connected repository", async () => {
    vi.mocked(checkManagedRepository).mockResolvedValueOnce({ ok: true, data: view("read-only") });
    render(<ManagedRepositorySection initialStatus={view("connected")} suggestion="" />);

    expect(screen.getByTestId("managed-repository-status")).toHaveTextContent(/connected/i);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    });

    expect(screen.getByTestId("managed-repository-status")).toHaveTextContent(/read only/i);
    expect(screen.getByTestId("managed-repository-live")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByTestId("managed-repository-live")).toHaveTextContent("Status: Read only");
  });

  it("shows the last answered time when GitHub could not be checked", () => {
    render(<ManagedRepositorySection initialStatus={view("check-failed")} suggestion="" />);
    expect(screen.getByTestId("managed-repository-last-checked")).toHaveTextContent("Last checked:");
  });

  it("logs in with the repository-controller purpose and announces progress", async () => {
    vi.useFakeTimers();
    vi.mocked(initiateDeviceFlow).mockResolvedValueOnce({
      success: true,
      data: { sessionId: "s1", userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", expiresIn: 900, interval: 5 },
    });
    vi.mocked(pollDeviceFlow).mockResolvedValueOnce({ status: "success", username: "ops" });
    vi.mocked(checkManagedRepository).mockResolvedValueOnce({ ok: true, data: view("connected") });
    render(<ManagedRepositorySection initialStatus={view("not-connected")} suggestion="" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connect GitHub" }));
    });
    expect(initiateDeviceFlow).toHaveBeenCalledWith({ purpose: "repository-controller" });
    expect(screen.getByText("ABCD-1234")).toBeInTheDocument();
    expect(screen.getByTestId("managed-repository-live")).toHaveTextContent(/approve on GitHub/);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(pollDeviceFlow).toHaveBeenCalledWith("s1");
    expect(screen.getByTestId("managed-repository-status")).toHaveTextContent(/connected/i);
    expect(screen.getByRole("button", { name: "Check again" })).toBeInTheDocument();
  });

  it("offers a new code when the device code expires", async () => {
    vi.useFakeTimers();
    vi.mocked(initiateDeviceFlow).mockResolvedValueOnce({
      success: true,
      data: { sessionId: "s1", userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", expiresIn: 900, interval: 5 },
    });
    vi.mocked(pollDeviceFlow).mockResolvedValueOnce({ status: "error", error: "Code expired, start over" });
    render(<ManagedRepositorySection initialStatus={view("not-connected")} suggestion="" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connect GitHub" }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(screen.getByRole("button", { name: "Get a new code" })).toBeInTheDocument();
    expect(screen.getByTestId("managed-repository-live")).toHaveTextContent("The code expired.");
  });
});
