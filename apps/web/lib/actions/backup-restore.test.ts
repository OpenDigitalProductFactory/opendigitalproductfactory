import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the auth + permissions + Prisma + the runner so the unit tests only
// exercise the server-action contract.
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));
vi.mock("@/lib/permissions", () => ({
  can: vi.fn(),
}));
vi.mock("@/lib/operate/backups/restore-preview", () => ({
  buildRestorePreview: vi.fn(),
}));
vi.mock("@/lib/operate/backups/postgres-restore-runner", () => ({
  runPostgresRestore: vi.fn(),
  isRestoreInFlight: vi.fn(),
  RestoreLockedError: class extends Error {
    constructor(_h: unknown, _s: unknown) {
      super("locked");
      this.name = "RestoreLockedError";
    }
  },
  RestoreIntegrityError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = "RestoreIntegrityError";
    }
  },
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    backupRestore: { findMany: vi.fn() },
    backupRun: { findUnique: vi.fn() },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import {
  confirmRestoreAction,
  previewRestoreAction,
} from "./backup-restore";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { runPostgresRestore } from "@/lib/operate/backups/postgres-restore-runner";
import { buildRestorePreview } from "@/lib/operate/backups/restore-preview";
import { prisma } from "@dpf/db";

const mockedAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockedCan = can as unknown as ReturnType<typeof vi.fn>;
const mockedRunner = runPostgresRestore as unknown as ReturnType<typeof vi.fn>;
const mockedPreview = buildRestorePreview as unknown as ReturnType<typeof vi.fn>;
const mockedBackupRunFindUnique = prisma.backupRun.findUnique as unknown as ReturnType<typeof vi.fn>;

describe("confirmRestoreAction (typed-confirmation gate)", () => {
  beforeEach(() => {
    mockedAuth.mockReset();
    mockedCan.mockReset();
    mockedRunner.mockReset();
    mockedBackupRunFindUnique.mockReset();
    // Default to the postgres path so tests that reach the runner stay on the
    // postgres branch (the only runner mocked in this file).
    mockedBackupRunFindUnique.mockResolvedValue({ target: "postgres" });
  });

  it("rejects when there is no session", async () => {
    mockedAuth.mockResolvedValue(null);
    const result = await confirmRestoreAction("src", "RESTORE");
    expect(result.ok).toBe(false);
    expect(result.errorClass).toBe("unauthorized");
    expect(mockedRunner).not.toHaveBeenCalled();
  });

  it("rejects when the user lacks the manage_provider_connections capability", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "u", isSuperuser: false } });
    mockedCan.mockReturnValue(false);
    const result = await confirmRestoreAction("src", "RESTORE");
    expect(result.ok).toBe(false);
    expect(result.errorClass).toBe("unauthorized");
    expect(mockedRunner).not.toHaveBeenCalled();
  });

  it("rejects when the confirmation text does not exactly equal RESTORE", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "u", isSuperuser: true } });
    mockedCan.mockReturnValue(true);

    for (const wrong of ["restore", "Restore", "RESTORE ", " RESTORE", "RESTORE!", ""]) {
      const result = await confirmRestoreAction("src", wrong);
      expect(result.ok).toBe(false);
      expect(result.errorClass).toBe("confirmation-required");
      expect(result.error).toMatch(/RESTORE/);
    }

    expect(mockedRunner).not.toHaveBeenCalled();
  });

  it("calls the runner only when confirmation is exactly RESTORE", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "u-1", isSuperuser: true } });
    mockedCan.mockReturnValue(true);
    mockedRunner.mockResolvedValue({ restoreId: "BR-x", status: "ok" });

    const result = await confirmRestoreAction("src", "RESTORE");
    expect(result.ok).toBe(true);
    expect(result.restoreId).toBe("BR-x");
    expect(mockedRunner).toHaveBeenCalledWith({
      sourceBackupRunId: "src",
      initiatedByUserId: "u-1",
    });
  });

  it("surfaces a structured failure when the runner reports status=failed", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "u", isSuperuser: true } });
    mockedCan.mockReturnValue(true);
    mockedRunner.mockResolvedValue({ restoreId: "BR-y", status: "failed" });

    const result = await confirmRestoreAction("src", "RESTORE");
    expect(result.ok).toBe(false);
    expect(result.restoreId).toBe("BR-y");
    expect(result.status).toBe("failed");
  });
});

describe("previewRestoreAction", () => {
  beforeEach(() => {
    mockedAuth.mockReset();
    mockedCan.mockReset();
    mockedPreview.mockReset();
  });

  it("rejects unauthorized callers", async () => {
    mockedAuth.mockResolvedValue(null);
    await expect(previewRestoreAction("src")).rejects.toThrow(/Unauthorized/);
    expect(mockedPreview).not.toHaveBeenCalled();
  });

  it("returns the impact preview for authorized callers", async () => {
    mockedAuth.mockResolvedValue({ user: { isSuperuser: true } });
    mockedCan.mockReturnValue(true);
    mockedPreview.mockResolvedValue({
      sourceBackupRunId: "src",
      sourceFinishedAt: "2026-05-17T22:00:00Z",
      sourceSizeBytes: 1024,
      sourceSha256: "deadbeef",
      sourceAgeMinutes: 5,
      impactSummary: "summary",
      fileMissing: false,
      sha256Mismatch: false,
      versionWarning: null,
    });

    const result = await previewRestoreAction("src");
    expect(result.sourceBackupRunId).toBe("src");
    expect(mockedPreview).toHaveBeenCalledWith({ sourceBackupRunId: "src" });
  });
});
