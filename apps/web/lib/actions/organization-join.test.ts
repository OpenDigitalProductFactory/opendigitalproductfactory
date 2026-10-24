import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockCan, mockIssue, mockImport, mockRevalidate, mockSelfUrl } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCan: vi.fn(),
  mockIssue: vi.fn(),
  mockImport: vi.fn(),
  mockRevalidate: vi.fn(),
  mockSelfUrl: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/permissions", () => ({ can: mockCan }));
vi.mock("@/lib/federation/organization-join-issue", () => ({ issueOrganizationJoinFile: mockIssue }));
vi.mock("@/lib/federation/organization-join-import", () => ({ importOrganizationJoinFile: mockImport }));
vi.mock("@/lib/federation/self-authority", () => ({ resolveLocalFederationAuthorityUrl: mockSelfUrl }));

import { importOrganizationJoinFileAction, issueOrganizationJoinFileAction } from "./organization-join";

const operator = { user: { id: "user-1", platformRole: "PLATFORM_ADMIN", isSuperuser: false } };
const EXPIRES = new Date(Date.now() + 30 * 60_000).toISOString();

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth.mockResolvedValue(operator);
  mockCan.mockReturnValue(true);
  mockSelfUrl.mockResolvedValue("http://192.168.0.152:3000");
  mockIssue.mockResolvedValue({ issued: true, packageText: "DPF_ORGANIZATION_JOIN_V2\n", fileName: "organization-join-192.168.0.200-abcd1234.dpfjoin", packageId: "a".repeat(32), intendedPeer: "192.168.0.200", caUrl: "https://192.168.0.152:9000/", expiresAt: EXPIRES });
  mockImport.mockResolvedValue({ imported: true, authorityUrl: "http://192.168.0.152:3000", caUrl: "https://192.168.0.152:9000/", intendedPeer: "192.168.0.200", expiresAt: EXPIRES, materialDir: "/dpf-federation/pki" });
});

describe("organization join actions — session boundary", () => {
  it("refuses an unauthenticated caller and a caller without manage_platform before touching the federation code", async () => {
    mockAuth.mockResolvedValueOnce(null);
    expect(await issueOrganizationJoinFileAction({ intendedPeer: "192.168.0.200" })).toMatchObject({ ok: false, error: "unauthorized" });
    mockCan.mockReturnValueOnce(false);
    expect(await importOrganizationJoinFileAction("DPF_ORGANIZATION_JOIN_V2\n")).toMatchObject({ ok: false, error: "forbidden" });
    expect(mockIssue).not.toHaveBeenCalled();
    expect(mockImport).not.toHaveBeenCalled();
  });
});

describe("issueOrganizationJoinFileAction", () => {
  it("mints through the portal with the request host as this authority's own address and returns the file once", async () => {
    const result = await issueOrganizationJoinFileAction({ intendedPeer: " 192.168.0.200 " });
    expect(result).toEqual({ ok: true, data: { fileName: "organization-join-192.168.0.200-abcd1234.dpfjoin", content: "DPF_ORGANIZATION_JOIN_V2\n", intendedPeer: "192.168.0.200", expiresAt: EXPIRES } });
    expect(mockIssue).toHaveBeenCalledWith({ intendedPeer: "192.168.0.200", requestHost: "http://192.168.0.152:3000" });
    expect(mockRevalidate).toHaveBeenCalledWith("/platform/federation-links");
  });

  it("maps the issuer's refusals to plain operator messages", async () => {
    expect(await issueOrganizationJoinFileAction({ intendedPeer: "" })).toMatchObject({ ok: false, error: "invalid_input" });
    mockIssue.mockResolvedValueOnce({ issued: false, reason: "not-the-authority" });
    expect(await issueOrganizationJoinFileAction({ intendedPeer: "x" })).toMatchObject({ ok: false, error: "not_ready", message: expect.stringContaining("organization installation") });
    mockIssue.mockResolvedValueOnce({ issued: false, reason: "own-address-unknown" });
    expect(await issueOrganizationJoinFileAction({ intendedPeer: "x" })).toMatchObject({ ok: false, error: "not_ready", message: expect.stringContaining("network address") });
    mockIssue.mockResolvedValueOnce({ issued: false, reason: "ca-unreachable", detail: "ECONNREFUSED" });
    expect(await issueOrganizationJoinFileAction({ intendedPeer: "x" })).toMatchObject({ ok: false, error: "not_ready", message: expect.stringContaining("ECONNREFUSED") });
  });
});

describe("importOrganizationJoinFileAction", () => {
  it("imports through the portal and reports where the installation joined", async () => {
    const result = await importOrganizationJoinFileAction("DPF_ORGANIZATION_JOIN_V2\npackage_id=x\n");
    expect(result).toEqual({ ok: true, data: { authorityUrl: "http://192.168.0.152:3000", intendedPeer: "192.168.0.200", message: "Joined the organization at 192.168.0.152:3000. The connection appears here trusted within a few minutes." } });
    expect(mockImport).toHaveBeenCalledWith({ fileText: "DPF_ORGANIZATION_JOIN_V2\npackage_id=x\n", requestHost: "http://192.168.0.152:3000" });
  });

  it("refuses an empty or oversized file before the importer runs, and maps the importer's refusals", async () => {
    expect(await importOrganizationJoinFileAction("   ")).toMatchObject({ ok: false, error: "invalid_input" });
    expect(await importOrganizationJoinFileAction("x".repeat(64 * 1024 + 1))).toMatchObject({ ok: false, error: "invalid_input" });
    expect(mockImport).not.toHaveBeenCalled();
    for (const [reason, error] of [["join-package-expired", "invalid_input"], ["intended-for-another-host", "invalid_input"], ["authority-unreachable", "not_ready"], ["authority-refused", "conflict"], ["chain-untrusted", "conflict"], ["material-not-writable", "not_ready"]] as const) {
      mockImport.mockResolvedValueOnce({ imported: false, reason });
      expect(await importOrganizationJoinFileAction("DPF_ORGANIZATION_JOIN_V2\n")).toMatchObject({ ok: false, error });
    }
  });
});
