import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const {
  mockAuth,
  mockCan,
  mockConfigFindFirst,
  mockListQueue,
  mockOrganizationFindFirst,
  mockResolvePrincipal,
  mockSyncPrincipal,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCan: vi.fn(),
  mockConfigFindFirst: vi.fn(),
  mockListQueue: vi.fn(),
  mockOrganizationFindFirst: vi.fn(),
  mockResolvePrincipal: vi.fn(),
  mockSyncPrincipal: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("not-found"); }) }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/permissions", () => ({ can: mockCan }));
vi.mock("@/lib/identity/principal-linking", () => ({
  resolvePrincipalIdForUser: mockResolvePrincipal,
  syncUserPrincipal: mockSyncPrincipal,
}));
vi.mock("@/lib/healthcare/care-intake-review-repository", () => ({
  listCareIntakeReviewQueue: mockListQueue,
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    organization: { findFirst: mockOrganizationFindFirst },
    storefrontConfig: { findFirst: mockConfigFindFirst },
  },
}));

describe("CareIntakeQueuePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      user: { id: "user-staff", type: "admin", platformRole: "HR-100", isSuperuser: false },
    });
    mockCan.mockReturnValue(true);
    mockOrganizationFindFirst.mockResolvedValue({ id: "org-a" });
    mockConfigFindFirst.mockResolvedValue({ archetype: { category: "healthcare-wellness" } });
    mockResolvePrincipal.mockResolvedValue("principal-staff");
    mockSyncPrincipal.mockResolvedValue({ principalId: "principal-synced" });
    mockListQueue.mockResolvedValue({ items: [] });
  });

  it("renders minimum-necessary readiness and exception details", async () => {
    mockListQueue.mockResolvedValue({ items: [{
      packetId: "packet-secret-id",
      patientReference: "A1B2C3D4E5",
      appointmentLinked: true,
      status: "in-progress",
      version: 2,
      dueAt: null,
      ready: false,
      completionPercent: 70,
      blockers: ["coverage-unverified", "exceptions-unresolved"],
      missingRequiredLinkIds: [],
      sourceModes: ["staff-assisted"],
      openExceptions: [{
        exceptionId: "exception-secret-id",
        exceptionType: "coverage",
        status: "open",
        severity: "medium",
        summary: "Insurance card image needs review",
        assignedToPrincipalId: null,
      }],
      accessGrants: [],
    }] });

    const { default: CareIntakeQueuePage } = await import("./page");
    const html = renderToStaticMarkup(await CareIntakeQueuePage());

    expect(html).toContain("Patient intake");
    expect(html).toContain("Patient A1B2C3D4E5");
    expect(html).toContain("Linked to a scheduled visit");
    expect(html).toContain("Coverage not verified");
    expect(html).toContain("Insurance card image needs review");
    expect(html).toContain("Clinical answers are not shown");
    expect(html).not.toContain("packet-secret-id");
    expect(html).not.toContain("exception-secret-id");
  });

  it("does not query intake outside healthcare archetypes", async () => {
    mockConfigFindFirst.mockResolvedValue({ archetype: { category: "professional-services" } });

    const { default: CareIntakeQueuePage } = await import("./page");
    const html = renderToStaticMarkup(await CareIntakeQueuePage());

    expect(html).toContain("Healthcare intake is not active");
    expect(mockListQueue).not.toHaveBeenCalled();
  });

  it("synchronizes the authenticated staff principal when onboarding has not created its alias", async () => {
    mockResolvePrincipal.mockResolvedValue(null);

    const { default: CareIntakeQueuePage } = await import("./page");
    const html = renderToStaticMarkup(await CareIntakeQueuePage());

    expect(mockSyncPrincipal).toHaveBeenCalledWith("user-staff");
    expect(mockListQueue).toHaveBeenCalledWith({
      organizationId: "org-a",
      actorPrincipalId: "principal-synced",
      limit: 50,
    });
    expect(html).toContain("No active intake packets");
  });
});
