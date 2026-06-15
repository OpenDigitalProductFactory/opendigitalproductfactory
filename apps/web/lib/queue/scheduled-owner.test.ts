import { describe, expect, it, vi } from "vitest";

import {
  resolveScheduledOwnerUserId,
  type ScheduledOwnerClient,
} from "./scheduled-owner";

function clientReturning(owner: { id: string } | null): ScheduledOwnerClient {
  return { user: { findFirst: vi.fn(async () => owner) } };
}

describe("resolveScheduledOwnerUserId", () => {
  it("returns the resolved superuser id", async () => {
    const db = clientReturning({ id: "usr_admin" });
    await expect(resolveScheduledOwnerUserId(db)).resolves.toBe("usr_admin");
  });

  it("resolves the oldest ACTIVE superuser (deterministic install owner)", async () => {
    const findFirst = vi.fn(async () => ({ id: "usr_admin" }));
    await resolveScheduledOwnerUserId({ user: { findFirst } });
    expect(findFirst).toHaveBeenCalledWith({
      where: { isSuperuser: true, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
  });

  it("throws rather than fall back to a sentinel when no owner exists", async () => {
    // Guards the regression this helper was built for: a hardcoded
    // userId:"system" silently violated TaskRun_userId_fkey. A missing owner
    // must fail loudly, never resolve to a non-existent principal.
    const db = clientReturning(null);
    await expect(resolveScheduledOwnerUserId(db)).rejects.toThrow(/superuser/i);
  });
});
