// Regression test for BI-1017777D — the research proposal decision surface
// checked only that SOMEONE was signed in. The product design for this gate is
// explicit ("AI research is SCHEDULED, PROPOSED, and requests human APPROVAL
// before any web/LLM execution"), so an authenticated-but-unprivileged user
// being able to fire enqueueResearchExecution defeats the gate outright.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, approveResearchMock, declineResearchMock, enqueueMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  approveResearchMock: vi.fn(),
  declineResearchMock: vi.fn(),
  enqueueMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/wiki/research-proposal", () => ({
  approveResearch: approveResearchMock,
  declineResearch: declineResearchMock,
  listPendingResearchProposals: vi.fn(async () => []),
}));
vi.mock("@/lib/wiki/research-execution", () => ({ enqueueResearchExecution: enqueueMock }));
vi.mock("@dpf/db", () => ({
  prisma: { organization: { findFirst: vi.fn(async () => ({ id: "org-1" })) } },
}));

import {
  approveResearchProposalAction,
  declineResearchProposalAction,
} from "./research-proposals";

/** manage_business_models is held by HR-000/HR-200/HR-300; HR-600 is the floor role. */
const CAPABLE = { user: { id: "u-owner", platformRole: "HR-300", isSuperuser: false } };
const FLOOR_ROLE = { user: { id: "u-floor", platformRole: "HR-600", isSuperuser: false } };

beforeEach(() => {
  vi.clearAllMocks();
  approveResearchMock.mockResolvedValue({ approved: true, proposal: {} });
  declineResearchMock.mockResolvedValue({ declined: true });
});

describe("approveResearchProposalAction authorization", () => {
  it("refuses an unauthenticated caller", async () => {
    authMock.mockResolvedValue(null);
    const res = await approveResearchProposalAction("RP-1");
    expect(res.ok).toBe(false);
    expect(approveResearchMock).not.toHaveBeenCalled();
  });

  it("refuses a signed-in user without the capability — no research run is enqueued", async () => {
    authMock.mockResolvedValue(FLOOR_ROLE);
    const res = await approveResearchProposalAction("RP-1");
    expect(res.ok).toBe(false);
    expect(approveResearchMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("allows a capable user", async () => {
    authMock.mockResolvedValue(CAPABLE);
    const res = await approveResearchProposalAction("RP-1");
    expect(res.ok).toBe(true);
    expect(approveResearchMock).toHaveBeenCalledTimes(1);
  });
});

describe("declineResearchProposalAction authorization", () => {
  it("refuses a signed-in user without the capability", async () => {
    authMock.mockResolvedValue(FLOOR_ROLE);
    const res = await declineResearchProposalAction("RP-1");
    expect(res.ok).toBe(false);
    expect(declineResearchMock).not.toHaveBeenCalled();
  });

  it("allows a capable user", async () => {
    authMock.mockResolvedValue(CAPABLE);
    const res = await declineResearchProposalAction("RP-1");
    expect(res.ok).toBe(true);
    expect(declineResearchMock).toHaveBeenCalledTimes(1);
  });
});
