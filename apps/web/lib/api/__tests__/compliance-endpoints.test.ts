import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@dpf/db", () => ({
  prisma: {
    regulatoryAlert: { findMany: vi.fn() },
    complianceIncident: { findMany: vi.fn() },
    control: { findMany: vi.fn() },
    regulation: { findMany: vi.fn() },
    complianceAudit: { findUnique: vi.fn() },
    auditFinding: { findMany: vi.fn() },
    correctiveAction: { findMany: vi.fn() },
  },
}));

vi.mock("../../api/auth-middleware.js", () => ({
  authenticateRequest: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { prisma } from "@dpf/db";
import { authenticateRequest } from "../../api/auth-middleware.js";

import { GET as alertsHandler } from "../../../app/api/v1/compliance/alerts/route.js";
import { GET as incidentsHandler } from "../../../app/api/v1/compliance/incidents/route.js";
import { GET as controlsHandler } from "../../../app/api/v1/compliance/controls/route.js";
import { GET as regulationsHandler } from "../../../app/api/v1/compliance/regulations/route.js";
import { GET as findingsHandler } from "../../../app/api/v1/compliance/audits/[id]/findings/route.js";
import { GET as correctiveActionsHandler } from "../../../app/api/v1/compliance/corrective-actions/route.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_AUTH = {
  user: {
    id: "user-1",
    email: "alice@example.com",
    type: "admin" as const,
    platformRole: "HR-000",
    isSuperuser: false,
    accountId: null,
    accountName: null,
    contactId: null,
  },
  capabilities: ["view_admin"],
};

function getRequest(path: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "GET",
    headers: { authorization: "Bearer valid-jwt" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// ALERTS
// ===========================================================================
describe("GET /api/v1/compliance/alerts", () => {
  it("returns paginated alerts", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.regulatoryAlert.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "alert-1", alertId: "RA-001", title: "New regulation", status: "pending", createdAt: new Date() },
    ]);

    const res = await alertsHandler(getRequest("/api/v1/compliance/alerts"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.length).toBe(1);
  });

  it("returns empty when no alerts", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.regulatoryAlert.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const res = await alertsHandler(getRequest("/api/v1/compliance/alerts"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const res = await alertsHandler(getRequest("/api/v1/compliance/alerts"));
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// INCIDENTS
// ===========================================================================
describe("GET /api/v1/compliance/incidents", () => {
  it("returns paginated incidents", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.complianceIncident.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "inc-1", title: "Data breach", severity: "high", occurredAt: new Date(), reportedBy: { id: "e-1", displayName: "Bob" } },
    ]);

    const res = await incidentsHandler(getRequest("/api/v1/compliance/incidents"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.length).toBe(1);
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const res = await incidentsHandler(getRequest("/api/v1/compliance/incidents"));
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// CONTROLS
// ===========================================================================
describe("GET /api/v1/compliance/controls", () => {
  it("returns paginated controls", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.control.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "ctrl-1", title: "Access control", implementationStatus: "implemented", ownerEmployee: null, _count: { obligations: 2 } },
    ]);

    const res = await controlsHandler(getRequest("/api/v1/compliance/controls"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.length).toBe(1);
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const res = await controlsHandler(getRequest("/api/v1/compliance/controls"));
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// REGULATIONS
// ===========================================================================
describe("GET /api/v1/compliance/regulations", () => {
  it("returns paginated regulations", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.regulation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "reg-1", shortName: "GDPR", jurisdiction: "EU", status: "active" },
    ]);

    const res = await regulationsHandler(getRequest("/api/v1/compliance/regulations"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.length).toBe(1);
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const res = await regulationsHandler(getRequest("/api/v1/compliance/regulations"));
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// AUDIT FINDINGS
// ===========================================================================
describe("GET /api/v1/compliance/audits/:id/findings", () => {
  it("returns findings for an audit", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.complianceAudit.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "audit-1" });
    (prisma.auditFinding.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "find-1", title: "Missing control", findingType: "non-conformity", control: null },
    ]);

    const res = await findingsHandler(
      getRequest("/api/v1/compliance/audits/audit-1/findings"),
      { params: Promise.resolve({ id: "audit-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.length).toBe(1);
  });

  it("returns 404 for nonexistent audit", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.complianceAudit.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await findingsHandler(
      getRequest("/api/v1/compliance/audits/nonexistent/findings"),
      { params: Promise.resolve({ id: "nonexistent" }) },
    );

    expect(res.status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const res = await findingsHandler(
      getRequest("/api/v1/compliance/audits/audit-1/findings"),
      { params: Promise.resolve({ id: "audit-1" }) },
    );

    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// CORRECTIVE ACTIONS
// ===========================================================================
describe("GET /api/v1/compliance/corrective-actions", () => {
  it("returns paginated corrective actions", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.correctiveAction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "ca-1", title: "Fix control gap", status: "open", owner: null, incident: null, auditFinding: null },
    ]);

    const res = await correctiveActionsHandler(getRequest("/api/v1/compliance/corrective-actions"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.length).toBe(1);
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const res = await correctiveActionsHandler(getRequest("/api/v1/compliance/corrective-actions"));
    expect(res.status).toBe(401);
  });
});
