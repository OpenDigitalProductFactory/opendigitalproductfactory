import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issuePreviewAutomationSignIn, assertPreviewAdmission, assertPreviewIssuerContainer, type PreviewAdmission } from "./preview-automation-sign-in";
const mocks = vi.hoisted(() => ({
  lease: vi.fn(), room: vi.fn(), actor: vi.fn(), execute: vi.fn(), mint: vi.fn(),
  disconnect: vi.fn(), createDb: vi.fn(), syncPrincipal: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: { nonProductionEnvironmentLease: { findUnique: mocks.lease }, workroom: { findFirst: mocks.room } }, createDatabaseClient: mocks.createDb }));
vi.mock("@/lib/work-capsules/handler-actor", () => ({ workCapsuleActor: mocks.actor }));
vi.mock("./automation-sign-in", () => ({ mintAutomationSignIn: mocks.mint }));
vi.mock("@/lib/identity/principal-linking", () => ({ syncUserPrincipal: mocks.syncPrincipal }));
vi.mock("node:child_process", () => {
  const execFile = Object.assign(() => {}, { [Symbol.for("nodejs.util.promisify.custom")]: mocks.execute });
  return { execFile };
});
const now = new Date("2026-10-11T00:00:00Z");
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); });
const lease: PreviewAdmission = { leaseId: "NPEL-1", ownerSessionId: "session", status: "active", expiresAt: new Date("2026-10-11T01:00:00Z"), worktreePath: "/feature", branchName: "codex/feature", url: "http://localhost:3001" };
describe("admitted preview automation identity", () => {
  it("requires active ownership and the canonical preview origin", () => {
    assertPreviewAdmission(lease, "session", now);
    for (const wrong of [{ ...lease, status: "queued" }, { ...lease, expiresAt: now }, { ...lease, ownerSessionId: "foreign" }, { ...lease, url: "http://localhost:3000" }, { ...lease, url: "http://localhost:3001@external.example" }]) {
      expect(() => assertPreviewAdmission(wrong, "session", now)).toThrow();
    }
  });
  it("requires the actual admitted source mount, source commit, class and container", () => {
    const container = { State: { Running: true }, NetworkSettings: { Ports: { "3000/tcp": [{ HostIp: "127.0.0.1", HostPort: "3001" }] } }, Mounts: [{ Type: "bind", Source: "/feature", Destination: "/workspace" }],
      Config: { Env: ["DPF_ENVIRONMENT_CLASS=development"], Labels: { "com.docker.compose.service": "dev-portal", "dpf.preview.lease": "NPEL-1", "dpf.preview.sha": "sha" } } };
    assertPreviewIssuerContainer(container, lease, "sha");
    expect(() => assertPreviewIssuerContainer(container, lease, "other-sha")).toThrow();
    container.NetworkSettings.Ports["3000/tcp"][0]!.HostPort = "3000";
    expect(() => assertPreviewIssuerContainer(container, lease, "sha")).toThrow();
    container.NetworkSettings.Ports["3000/tcp"][0]!.HostPort = "3001";
    container.Mounts[0]!.Source = "/root";
    expect(() => assertPreviewIssuerContainer(container, lease, "sha")).toThrow();
  });
});

describe("Docker Desktop host mount identity", () => {
  it("accepts the Windows host path from Linux but rejects foreign drive, worktree and relative paths", () => {
    const windowsLease = { ...lease, worktreePath: "D:/DPF-worktrees/scoped-investment-balance" };
    const container = { State: { Running: true }, NetworkSettings: { Ports: { "3000/tcp": [{ HostIp: "127.0.0.1", HostPort: "3001" }] } }, Mounts: [{ Type: "bind", Source: "/run/desktop/mnt/host/d/DPF-worktrees/scoped-investment-balance", Destination: "/workspace" }], Config: { Env: ["DPF_ENVIRONMENT_CLASS=development"], Labels: { "com.docker.compose.service": "dev-portal", "dpf.preview.lease": "NPEL-1", "dpf.preview.sha": "sha" } } };
    assertPreviewIssuerContainer(container, windowsLease, "sha");
    for (const wrong of ["/run/desktop/mnt/host/e/DPF-worktrees/scoped-investment-balance", "/run/desktop/mnt/host/d/DPF-source-root", "D:DPF-worktrees/scoped-investment-balance", "/run/desktop/mnt/host/d/DPF-worktrees/../DPF-source-root"]) {
      container.Mounts[0]!.Source = wrong;
      expect(() => assertPreviewIssuerContainer(container, windowsLease, "sha")).toThrow("preview_issuer_binding_mismatch");
    }
  });
});

describe("canonical preview session issuance", () => {
  const sha = "a".repeat(40);
  const db = { $disconnect: mocks.disconnect };
  const admitted = { ...lease, expiresAt: new Date(now.getTime() + 60 * 60 * 1000) };
  const container = () => ({ State: { Running: true }, NetworkSettings: { Ports: { "3000/tcp": [{ HostIp: "127.0.0.1", HostPort: "3001" }] } }, Mounts: [{ Type: "bind", Source: "/feature", Destination: "/workspace" }],
    Config: { Env: ["DPF_ENVIRONMENT_CLASS=development", "DATABASE_URL=postgresql://dpf:dpf_dev@dev-postgres:5432/dpf", `AUTH_SECRET=${"preview-only-secret".repeat(4)}`],
      Labels: { "com.docker.compose.service": "dev-portal", "dpf.preview.lease": "NPEL-1", "dpf.preview.sha": sha } } });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lease.mockResolvedValue(admitted);
    mocks.room.mockImplementation(async ({ where }) => where.executorRef ? { repositoryFullName: "owner/repo", status: "working" } : { headSha: sha, repositoryFullName: "owner/repo" });
    mocks.actor.mockResolvedValue({ principalId: "owning-principal" });
    mocks.createDb.mockReturnValue(db);
    mocks.execute.mockImplementation(async (_bin, args) => ({ stdout: args[0] === "ps" ? "abc123def456" : JSON.stringify([container()]), stderr: "" }));
    mocks.mint.mockResolvedValue({ issued: true, url: "http://localhost:3001/api/automation/sign-in?token=preview-only", because: "development" });
  });
  it("uses the inspected preview DB/key and authenticated owning Workroom rather than the production singleton", async () => {
    const issued = await issuePreviewAutomationSignIn({ leaseId: "NPEL-1", ownerSessionId: "session", userId: "actor", nextPath: "/workspace" });
    expect(issued.previewIdentity.sourceSha).toBe(sha);
    expect(mocks.room).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ executorRef: "session", leaseHolderPrincipalId: "owning-principal" }) }));
    const sourceWhere = mocks.room.mock.calls.find(([arg]) => arg.where.worktreePath)?.[0].where;
    expect(sourceWhere).toMatchObject({ worktreePath: "/feature", headBranch: "codex/feature", leaseHolderPrincipalId: "owning-principal", repositoryFullName: "owner/repo" });
    expect(sourceWhere).not.toHaveProperty("executorRef");
    expect(sourceWhere).not.toHaveProperty("leaseExpiresAt");
    expect(mocks.createDb).toHaveBeenCalledWith("postgresql://dpf:dpf_dev@dev-postgres:5432/dpf");
    expect(mocks.mint).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: admitted.url }), expect.objectContaining({ db, env: expect.objectContaining({ DPF_ENVIRONMENT_CLASS: "development", AUTH_SECRET: "preview-only-secret".repeat(4) }) }));
    expect(mocks.disconnect).toHaveBeenCalledOnce();
    expect(mocks.execute.mock.calls.some(([, args]) => args[0] === "exec")).toBe(false);
  });
  it("refuses an unowned source room before Docker or preview DB access", async () => {
    mocks.room.mockImplementation(async ({ where }) => where.executorRef ? { repositoryFullName: "owner/repo", status: "working" } : null);
    await expect(issuePreviewAutomationSignIn({ leaseId: "NPEL-1", ownerSessionId: "session", userId: "foreign" })).rejects.toThrow(/workroom_unverified/);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.createDb).not.toHaveBeenCalled();
  });
  it("refuses a changed source after minting rather than returning stale identity", async () => {
    let sourceReads = 0;
    mocks.room.mockImplementation(async ({ where }) => where.executorRef ? { repositoryFullName: "owner/repo", status: "working" }
      : { headSha: ++sourceReads === 1 ? sha : "b".repeat(40) });
    await expect(issuePreviewAutomationSignIn({ leaseId: "NPEL-1", ownerSessionId: "session", userId: "actor" })).rejects.toThrow(/source_changed/);
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });
  it("refuses an expired or foreign verification Workroom before Docker access", async () => {
    mocks.room.mockImplementation(async ({ where }) => where.executorRef ? null : { headSha: sha, repositoryFullName: "owner/repo" });
    await expect(issuePreviewAutomationSignIn({ leaseId: "NPEL-1", ownerSessionId: "session", userId: "actor" })).rejects.toThrow(/verification_workroom_unverified/);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("refuses a terminal verifier even with a remaining lease timestamp", async () => {
    mocks.room.mockResolvedValue({ repositoryFullName: "owner/repo", status: "complete" });
    await expect(issuePreviewAutomationSignIn({ leaseId: "NPEL-1", ownerSessionId: "session", userId: "actor" })).rejects.toThrow(/verification_workroom_unverified/);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("does not return a sign-in if the reservation expires during issuance", async () => {
    mocks.lease.mockResolvedValueOnce(admitted).mockResolvedValueOnce({ ...admitted, status: "expired" });
    await expect(issuePreviewAutomationSignIn({ leaseId: "NPEL-1", ownerSessionId: "session", userId: "actor" })).rejects.toThrow(/not_admitted/);
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });
});
