import { describe, expect, it, vi } from "vitest";
import { reconcileRoutes } from "./reconcile-routes";
import type { RouteManifestRow } from "./route-extract";

const ROWS: RouteManifestRow[] = [
  { routePath: "/admin", kind: "page", segments: ["admin"], dynamicParams: [], file: "apps/web/app/(shell)/admin/page.tsx" },
  { routePath: "/admin/settings", kind: "page", segments: ["admin", "settings"], dynamicParams: [], file: "apps/web/app/(shell)/admin/settings/page.tsx" },
];

describe("reconcileRoutes", () => {
  it("skips cleanly when the manifest is absent/empty — without touching the seeder", async () => {
    const db = { eaNotation: { findUnique: vi.fn() } };
    const r = await reconcileRoutes({ db: db as never, manifest: { routes: [] } });
    expect(r.status).toBe("skipped");
    expect(db.eaNotation.findUnique).not.toHaveBeenCalled();
  });

  it("skips cleanly when the manifest has no routes field at all", async () => {
    const db = { eaNotation: { findUnique: vi.fn() } };
    const r = await reconcileRoutes({ db: db as never, manifest: {} });
    expect(r.status).toBe("skipped");
    expect(db.eaNotation.findUnique).not.toHaveBeenCalled();
  });

  it("threads manifest rows → model → seeder (notation absent → applySysmlModel skips, but the path runs)", async () => {
    const db = { eaNotation: { findUnique: vi.fn().mockResolvedValue(null) } };
    const r = await reconcileRoutes({ db: db as never, manifest: { routes: ROWS } });
    expect(r.status).toBe("skipped");
    expect(db.eaNotation.findUnique).toHaveBeenCalledTimes(1); // the seeder WAS invoked
  });
});
