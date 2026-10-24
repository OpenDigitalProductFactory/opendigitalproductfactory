// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockImport, mockIssue } = vi.hoisted(() => ({
  mockImport: vi.fn(),
  mockIssue: vi.fn(),
}));

vi.mock("@/lib/actions/organization-join", () => ({
  importOrganizationJoinFileAction: mockImport,
  issueOrganizationJoinFileAction: mockIssue,
}));

import { OrganizationJoinPanel } from "./OrganizationJoinPanel";

function joinPackage(expiresAt = new Date(Date.now() + 10 * 60_000), peer = "windows-dev.local") {
  return [
    "DPF_ORGANIZATION_JOIN_V2",
    "package_id=0123456789abcdef0123456789abcdef",
    "ca_url=https://founder-hub.local:9000",
    `root_fingerprint=${"A".repeat(64)}`,
    `intended_hostname=${peer}`,
    `intended_sans=${peer}`,
    `expires_at=${Math.floor(expiresAt.getTime() / 1000)}`,
    "enrollment_token=must-never-render",
    "edge_client_enrollment_token=must-never-render-either",
    "",
  ].join("\n");
}

beforeEach(() => {
  vi.resetAllMocks();
  mockImport.mockResolvedValue({ ok: true, data: { authorityUrl: "http://founder-hub.local:3000", intendedPeer: "windows-dev.local", message: "Joined the organization at founder-hub.local:3000." } });
  mockIssue.mockResolvedValue({ ok: true, data: { fileName: "organization-join-windows-dev.local-abcd1234.dpfjoin", content: "DPF_ORGANIZATION_JOIN_V2\n", intendedPeer: "windows-dev.local", expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() } });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:join") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  HTMLAnchorElement.prototype.click = vi.fn();
});

afterEach(() => cleanup());

describe("OrganizationJoinPanel", () => {
  it("offers exactly the two portal-mediated acts and no edge-node setup", () => {
    render(<OrganizationJoinPanel candidates={[]} />);

    expect(screen.getByRole("heading", { name: "Connect your own installations" })).toBeTruthy();
    expect(screen.getByText(/No commands, certificate copying, or CA password handling/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create join file" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Join this installation" })).toBeTruthy();
    expect(screen.queryByText(/Enable secure/)).toBeNull();
    expect(screen.queryByText(/No installation has reported/)).toBeNull();
    expect(screen.getByText(/does not share backlog data/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Create join file" }));
    expect(screen.getByRole("button", { name: "Back to choices" }).className).toContain("min-h-11");
  });

  it("issues the file through the portal for a chosen trusted installation and downloads it once", async () => {
    render(<OrganizationJoinPanel candidates={[{ hostname: "windows-dev.local", displayName: "Windows test installation" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Create join file" }));
    expect((screen.getByLabelText(/^Installation that will join/) as HTMLSelectElement).value).toBe("windows-dev.local");
    fireEvent.click(screen.getByLabelText(/I confirm this file is for windows-dev.local/));
    fireEvent.click(screen.getByRole("button", { name: "Create one-time file" }));

    await waitFor(() => expect(mockIssue).toHaveBeenCalledWith({ intendedPeer: "windows-dev.local" }));
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled());
    expect((await screen.findByRole("status")).textContent).toMatch(/downloaded once/i);
  });

  it("lets the operator name another installation and surfaces the server's refusal", async () => {
    render(<OrganizationJoinPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Create join file" }));
    expect((screen.getByLabelText(/^Installation that will join/) as HTMLSelectElement).value).toBe("__other__");
    fireEvent.change(screen.getByLabelText(/^Installation name/), { target: { value: "192.168.0.200" } });
    fireEvent.click(screen.getByLabelText(/I confirm this file is for 192.168.0.200/));
    mockIssue.mockResolvedValueOnce({ ok: false, error: "not_ready", message: "Only the organization installation can create join files" });
    fireEvent.click(screen.getByRole("button", { name: "Create one-time file" }));
    await waitFor(() => expect(mockIssue).toHaveBeenCalledWith({ intendedPeer: "192.168.0.200" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Only the organization installation/);
  });

  it("previews a valid file without rendering either enrollment token", async () => {
    render(<OrganizationJoinPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Join this installation" }));
    fireEvent.change(screen.getByLabelText(/^Choose a \.dpfjoin file/), { target: { files: [new File([joinPackage()], "join.dpfjoin", { type: "application/octet-stream" })] } });

    expect(await screen.findByText("founder-hub.local:9000")).toBeTruthy();
    expect(screen.getAllByText(/windows-dev\.local/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("must-never-render");
    expect(screen.getByRole("button", { name: "Join organization" }).hasAttribute("disabled")).toBe(true);
  });

  it("joins through the portal with nothing typed", async () => {
    render(<OrganizationJoinPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Join this installation" }));
    const raw = joinPackage();
    fireEvent.change(screen.getByLabelText(/^Choose a \.dpfjoin file/), { target: { files: [new File([raw], "join.dpfjoin")] } });
    await screen.findByText("founder-hub.local:9000");
    fireEvent.click(screen.getByLabelText(/I confirm this file is for windows-dev.local/));
    fireEvent.click(screen.getByRole("button", { name: "Join organization" }));

    await waitFor(() => expect(mockImport).toHaveBeenCalledWith(raw));
    expect((await screen.findByRole("status")).textContent).toMatch(/Joined the organization/);
  });

  it("rejects an expired file before approval and surfaces the server's wrong-host refusal", async () => {
    render(<OrganizationJoinPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Join this installation" }));
    fireEvent.change(screen.getByLabelText(/^Choose a \.dpfjoin file/), { target: { files: [new File([joinPackage(new Date(Date.now() - 60_000))], "expired.dpfjoin")] } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/expired/i);
    expect(mockImport).not.toHaveBeenCalled();

    mockImport.mockResolvedValueOnce({ ok: false, error: "invalid_input", message: "The join file was created for another installation" });
    const raw = joinPackage(new Date(Date.now() + 10 * 60_000), "another-host.local");
    fireEvent.change(screen.getByLabelText(/^Choose a \.dpfjoin file/), { target: { files: [new File([raw], "wrong.dpfjoin")] } });
    await screen.findByText("founder-hub.local:9000");
    fireEvent.click(screen.getByLabelText(/I confirm this file is for another-host.local/));
    fireEvent.click(screen.getByRole("button", { name: "Join organization" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/created for another installation/i);
  });
});
