import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  revalidatePath: vi.fn(),
  prisma: {
    userFact: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import * as proactivityActions from "./proactivity";

// BI-87C9C91C — proactivity is owned by the outcome-specific Workroom, not by a
// coworker identity.
//
// This file used to test reading and writing an `agent:<agentId>`-scoped
// preference. Those actions are removed, so the contract worth pinning is their
// ABSENCE: the defect this guards against is a per-coworker write path being
// reintroduced, which would report success while changing no behaviour, since
// nothing consults an agent-scoped proactivity fact any more.
describe("proactivity actions", () => {
  it("exposes no per-coworker proactivity read or write", () => {
    const exported = Object.keys(proactivityActions);
    expect(exported).not.toContain("getCoworkerProactivityPreference");
    expect(exported).not.toContain("getCoworkerProactivityPreferences");
    expect(exported).not.toContain("saveCoworkerProactivityPreference");
  });

  // The self-task cadence read is a different concern — it reports what the
  // ScheduledAgentTask engine has registered, and survives.
  it("still exposes the self-task cadence read", () => {
    expect(typeof proactivityActions.getCoworkerSelfTaskCadenceInfo).toBe("function");
  });
});
