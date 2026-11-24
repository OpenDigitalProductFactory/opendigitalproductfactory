import { describe, expect, it } from "vitest";

import { buildUploadsRunEnv, resolveUploadRoots } from "./uploads-backup-runner";

// BI-1C6BF6B6: the backup must read the directories the writers write.

describe("resolveUploadRoots", () => {
  it("uses the PlatformConfig row first, as documents, media and attachments do", () => {
    const roots = resolveUploadRoots({
      configuredPath: "/srv/configured-uploads",
      env: { UPLOAD_STORAGE_PATH: "/srv/env-uploads" },
      voiceRoot: "/srv/env-uploads",
    });
    expect(roots).toEqual([
      { name: "upload-store", path: "/srv/configured-uploads", resolvedFrom: "platform-config" },
      { name: "voice", path: "/srv/env-uploads", resolvedFrom: "env" },
    ]);
  });

  it("falls back to UPLOAD_STORAGE_PATH and folds a coinciding voice root into one root", () => {
    const roots = resolveUploadRoots({ configuredPath: "  ", env: { UPLOAD_STORAGE_PATH: "/srv/uploads" }, voiceRoot: "/srv/uploads" });
    expect(roots).toEqual([{ name: "upload-store", path: "/srv/uploads", resolvedFrom: "env" }]);
  });

  it("folds a voice root that sits inside the upload store", () => {
    const roots = resolveUploadRoots({ configuredPath: "/srv/uploads", env: {}, voiceRoot: "/srv/uploads/voice" });
    expect(roots.map((r) => r.name)).toEqual(["upload-store"]);
  });

  it("refuses an upload store that sits inside the voice root", () => {
    expect(() => resolveUploadRoots({ configuredPath: "/srv/data/uploads", env: {}, voiceRoot: "/srv/data" })).toThrow(/sits inside the voice root/);
  });

  it("resolves the default against the working directory", () => {
    const roots = resolveUploadRoots({ configuredPath: null, env: {}, cwd: "/app/apps/web", voiceRoot: "/app/apps/web/data/uploads" });
    expect(roots).toEqual([{ name: "upload-store", path: "/app/apps/web/data/uploads", resolvedFrom: "default" }]);
  });
});

describe("buildUploadsRunEnv", () => {
  const roots = [{ name: "upload-store", path: "/srv/uploads", resolvedFrom: "env" as const }];

  it("passes the roots and the paired dump to the writer", () => {
    const built = buildUploadsRunEnv({
      roots,
      backupsRoot: "/backups",
      paired: { id: "run-1", storagePath: "postgres/2026-11-24T03-00-00Z", sha256: "abc", status: "ok", target: "postgres" },
    });
    expect(built).toEqual({
      ok: true,
      data: {
        DPF_UPLOAD_ROOTS: JSON.stringify(roots),
        DPF_BLOB_ROOT_NAME: "upload-store",
        PAIRED_POSTGRES_RUN_ID: "run-1",
        PAIRED_POSTGRES_DUMP: "/backups/postgres/2026-11-24T03-00-00Z/dpf.dump",
        PAIRED_POSTGRES_SHA256: "abc",
      },
    });
  });

  it("refuses to pair with a failed or non-Postgres run", () => {
    expect(buildUploadsRunEnv({ roots, backupsRoot: "/backups", paired: { id: "r", storagePath: "p", sha256: null, status: "failed", target: "postgres" } }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/did not finish ok/) });
    expect(buildUploadsRunEnv({ roots, backupsRoot: "/backups", paired: { id: "r", storagePath: "p", sha256: "x", status: "ok", target: "uploads" } }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/not postgres/) });
  });
});
