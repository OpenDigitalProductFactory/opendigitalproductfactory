// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAuthorize,
  mockCancel,
  mockConfirm,
  mockDownload,
  mockImport,
  mockQueue,
  mockStatus,
} = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockCancel: vi.fn(),
  mockConfirm: vi.fn(),
  mockDownload: vi.fn(),
  mockImport: vi.fn(),
  mockQueue: vi.fn(),
  mockStatus: vi.fn(),
}));

vi.mock("@/components/ui/Dialog", () => ({ confirmDialog: mockConfirm }));
vi.mock("@/lib/actions/organization-join", () => ({
  authorizeOrganizationJoinNodeAction: mockAuthorize,
  cancelOrganizationJoinActionAction: mockCancel,
  downloadIssuedJoinPackageAction: mockDownload,
  getOrganizationJoinActionStatusAction: mockStatus,
  importOrganizationJoinFileAction: mockImport,
  queueOrganizationJoinActionAction: mockQueue,
}));

import { OrganizationJoinPanel } from "./OrganizationJoinPanel";
import type { OrganizationJoinNodeSummary } from "@/lib/actions/organization-join";

const authority: OrganizationJoinNodeSummary = {
  edgeNodeId: "edge-authority",
  nodeId: "edge-1",
  displayName: "Founder Hub Mac",
  platform: "darwin",
  status: "active",
  trustState: "trusted",
  role: "authority",
  actionType: "organization.join.issue",
  hostIdentity: "founder-hub.local",
  ready: true,
  readinessMessage: "Secure host action channel ready",
  latestAction: null,
};

const member: OrganizationJoinNodeSummary = {
  edgeNodeId: "edge-member",
  nodeId: "edge-2",
  displayName: "Windows test installation",
  platform: "win32",
  status: "active",
  trustState: "trusted",
  role: "member",
  actionType: "organization.join.import",
  hostIdentity: "windows-dev.local",
  ready: true,
  readinessMessage: "Secure host action channel ready",
  latestAction: null,
};

function joinPackage(expiresAt = new Date(Date.now() + 10 * 60_000), peer = member.hostIdentity!) {
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
  mockConfirm.mockResolvedValue(true);
  mockAuthorize.mockResolvedValue({ ok: true });
  mockQueue.mockResolvedValue({ ok: true, actionKey: "ra-join-1" });
  mockImport.mockResolvedValue({ ok: true, data: { authorityUrl: "http://founder-hub.local:3000", intendedPeer: "windows-dev.local", message: "Joined the organization at founder-hub.local:3000." } });
  mockStatus.mockResolvedValue({
    ok: true,
    actionKey: "ra-join-1",
    actionType: "organization.join.issue",
    status: "queued",
    approvalState: "approved",
    packageReady: false,
    evidence: {},
  });
});

afterEach(() => cleanup());

describe("OrganizationJoinPanel", () => {
  it("presents the no-command workflow before technical detail", () => {
    render(<OrganizationJoinPanel nodes={[authority, member]} />);

    expect(screen.getByRole("heading", { name: "Connect your own installations" })).toBeTruthy();
    expect(screen.getByText(/No commands, certificate copying, or CA password handling/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create join file" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Join this installation" })).toBeTruthy();
    expect(screen.getByText(/does not share backlog data/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Create join file" }));
    expect(screen.getByRole("button", { name: "Back to choices" }).className).toContain("min-h-11");
  });

  it("explicitly enables only the named host action after confirmation", async () => {
    render(<OrganizationJoinPanel nodes={[{ ...member, ready: false, readinessMessage: "Allow the organization setup action for this installation" }]} />);

    fireEvent.click(screen.getByRole("button", { name: "Enable secure setup" }));

    await waitFor(() => expect(mockAuthorize).toHaveBeenCalledWith({
      edgeNodeId: "edge-member",
      actionType: "organization.join.import",
      operatorConfirmed: true,
    }));
  });

  it("queues a short-lived authority issue only after local confirmation", async () => {
    render(<OrganizationJoinPanel nodes={[authority]} />);
    fireEvent.click(screen.getByRole("button", { name: "Create join file" }));
    fireEvent.change(screen.getByLabelText(/^Installation name/), { target: { value: "windows-dev.local" } });
    fireEvent.change(screen.getByLabelText(/^Join file expiry/), { target: { value: "600" } });
    fireEvent.click(screen.getByLabelText(/I confirm this file is for windows-dev.local/));
    fireEvent.click(screen.getByRole("button", { name: "Create one-time file" }));

    await waitFor(() => expect(mockQueue).toHaveBeenCalledWith({
      actionType: "organization.join.issue",
      edgeNodeId: "edge-authority",
      parameters: { intendedPeer: "windows-dev.local", ttlSeconds: 600 },
      operatorConfirmed: true,
    }));
  });

  it("previews a valid file without rendering either enrollment token", async () => {
    render(<OrganizationJoinPanel nodes={[member]} />);
    fireEvent.click(screen.getByRole("button", { name: "Join this installation" }));
    const file = new File([joinPackage()], "founder-hub-to-windows.dpfjoin", { type: "application/octet-stream" });
    fireEvent.change(screen.getByLabelText(/^Choose a \.dpfjoin file/), { target: { files: [file] } });

    expect(await screen.findByText("founder-hub.local:9000")).toBeTruthy();
    expect(screen.getAllByText(/windows-dev\.local/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("must-never-render");
    expect(screen.getByRole("button", { name: "Join organization" }).hasAttribute("disabled")).toBe(true);
  });

  it("joins through the portal with no installation selected and nothing typed", async () => {
    render(<OrganizationJoinPanel nodes={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Join this installation" }));
    expect(screen.queryByText(/No installation has reported/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Enable secure setup" })).toBeNull();
    const raw = joinPackage();
    fireEvent.change(screen.getByLabelText(/^Choose a \.dpfjoin file/), { target: { files: [new File([raw], "join.dpfjoin")] } });
    await screen.findByText("founder-hub.local:9000");
    fireEvent.click(screen.getByLabelText(/I confirm this file is for windows-dev.local/));
    fireEvent.click(screen.getByRole("button", { name: "Join organization" }));

    await waitFor(() => expect(mockImport).toHaveBeenCalledWith(raw));
    expect(mockQueue).not.toHaveBeenCalled();
    expect((await screen.findByRole("status")).textContent).toMatch(/Joined the organization/);
  });

  it("rejects an expired file before approval and surfaces the server's wrong-host refusal", async () => {
    render(<OrganizationJoinPanel nodes={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Join this installation" }));
    const expired = new File([joinPackage(new Date(Date.now() - 60_000))], "expired.dpfjoin");
    fireEvent.change(screen.getByLabelText(/^Choose a \.dpfjoin file/), { target: { files: [expired] } });
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

  it("resumes a queued action from server state after refresh", () => {
    render(<OrganizationJoinPanel nodes={[{
      ...authority,
      latestAction: {
        actionKey: "ra-resume",
        actionType: "organization.join.issue",
        status: "queued",
        approvalState: "approved",
        packageReady: false,
        evidence: { intendedPeer: "windows-dev.local" },
        createdAt: new Date().toISOString(),
      },
    }]} />);

    expect(screen.getByText("Approved and waiting for Founder Hub Mac")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel request" })).toBeTruthy();
  });

  it("offers a fresh request after a failed host action", () => {
    render(<OrganizationJoinPanel nodes={[{
      ...authority,
      latestAction: {
        actionKey: "ra-failed",
        actionType: "organization.join.issue",
        status: "failed",
        approvalState: "approved",
        packageReady: false,
        evidence: { errorCode: "portal-health-failed" },
        createdAt: new Date().toISOString(),
      },
    }]} />);

    fireEvent.click(screen.getByRole("button", { name: "Create join file" }));
    expect(screen.getByLabelText(/^Installation name/)).toBeTruthy();
    expect(screen.getByText(/restored its previous settings/i)).toBeTruthy();
  });
});
