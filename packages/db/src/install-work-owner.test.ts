import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { findInstallWorkOwnerUserId, INSTALL_WORK_OWNER_WHERE } from "./install-work-owner";

// BI-858FDE5A: a new scheduled task seeded after an account handover was born
// under the handed-over account (acceptance-sweep-daily and
// demand-scoring-steward-daily, 2026-10-07), because every seed picked "the
// oldest superuser". The install owner skips handed-over and inactive accounts.

type UserRow = { id: string; isSuperuser: boolean; isActive: boolean; workHandedOverAt: Date | null; createdAt: Date };

function fakeUsers(rows: UserRow[]) {
  return {
    user: {
      findFirst: async ({ where }: { where: Partial<UserRow> }) => {
        const match = rows
          .filter((r) => Object.entries(where).every(([k, v]) => r[k as keyof UserRow] === v))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
        return match ? { id: match.id } : null;
      },
    },
  } as never;
}

const at = (iso: string) => new Date(iso);

describe("findInstallWorkOwnerUserId", () => {
  it("skips the oldest superuser once its work was handed over", async () => {
    const db = fakeUsers([
      { id: "admin", isSuperuser: true, isActive: true, workHandedOverAt: at("2026-10-01T10:41:00Z"), createdAt: at("2026-06-08T00:00:00Z") },
      { id: "laura", isSuperuser: true, isActive: true, workHandedOverAt: null, createdAt: at("2026-06-09T00:00:00Z") },
      { id: "mark", isSuperuser: true, isActive: true, workHandedOverAt: null, createdAt: at("2026-08-12T00:00:00Z") },
    ]);
    expect(await findInstallWorkOwnerUserId(db)).toBe("laura");
  });

  it("skips an inactive superuser and returns null when no one is active", async () => {
    const db = fakeUsers([
      { id: "gone", isSuperuser: true, isActive: false, workHandedOverAt: null, createdAt: at("2026-06-08T00:00:00Z") },
    ]);
    expect(await findInstallWorkOwnerUserId(db)).toBeNull();
  });

  it("never stops an upgrade: with every active superuser handed over, the oldest active one is still returned", async () => {
    const db = fakeUsers([
      { id: "admin", isSuperuser: true, isActive: true, workHandedOverAt: at("2026-10-01T10:41:00Z"), createdAt: at("2026-06-08T00:00:00Z") },
    ]);
    expect(await findInstallWorkOwnerUserId(db)).toBe("admin");
  });

  it("keeps the fresh-install answer: the oldest active superuser", async () => {
    const db = fakeUsers([
      { id: "admin", isSuperuser: true, isActive: true, workHandedOverAt: null, createdAt: at("2026-06-08T00:00:00Z") },
      { id: "staff", isSuperuser: false, isActive: true, workHandedOverAt: null, createdAt: at("2026-06-01T00:00:00Z") },
    ]);
    expect(await findInstallWorkOwnerUserId(db)).toBe("admin");
  });

  it("states the one eligibility filter", () => {
    expect(INSTALL_WORK_OWNER_WHERE).toEqual({ isSuperuser: true, isActive: true, workHandedOverAt: null });
  });
});

// Guard: every task seed names its owner through the shared rule. A local
// "oldest superuser" lookup is how the handed-over account got new work.
describe("install work owner guard", () => {
  it("no seed module looks up a superuser owner on its own", () => {
    const dir = __dirname;
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "install-work-owner.ts")
      .filter((f) => /user\.findFirst\(\{\s*where:\s*\{\s*isSuperuser:\s*true/.test(readFileSync(join(dir, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
