import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  can: vi.fn(),
}));

vi.mock("@/lib/governance-data", () => ({
  getUserTeamIds: vi.fn(),
  createAuthorizationDecisionLog: vi.fn(),
}));

vi.mock("@/lib/principal-context", () => ({
  buildPrincipalContext: vi.fn(),
}));

vi.mock("@/lib/governance-resolver", () => ({
  resolveGovernedAction: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    platformRole: { findUnique: vi.fn() },
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    userGroup: {
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { summarizeGovernedLifecycleAttempt } from "@/lib/user-governance";

describe("summarizeGovernedLifecycleAttempt", () => {
  it("denies when a non-superuser tries to modify a superuser account", () => {
    const result = summarizeGovernedLifecycleAttempt({
      actorIsSuperuser: false,
      targetIsSuperuser: true,
    });

    expect(result.decision).toBe("deny");
    expect(result.message).toMatch(/superuser/i);
  });
});
