/**
 * Contract tests for POST /api/v1/work-items/:itemId/evidence — the append
 * path for job-completion photos. The wire shape + merge logic are unit-tested
 * separately in lib/api/work-item-evidence.test.ts; these tests cover the
 * auth, assignment, and 404 branches plus the Prisma update payload.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockFindUnique, mockUpdate } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock("@/lib/api/auth-middleware", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/auth-middleware")
  >("@/lib/api/auth-middleware");
  return { ...actual, authenticateRequest: mockAuth };
});

vi.mock("@dpf/db", () => ({
  prisma: { workItem: { findUnique: mockFindUnique, update: mockUpdate } },
  Prisma: {},
}));

import { POST } from "./route";
import { ApiError } from "@/lib/api/error";

const USER = {
  user: {
    id: "u_emp_1",
    email: "tech@example.com",
    type: "admin" as const,
    platformRole: null,
    isSuperuser: false,
    accountId: null,
    accountName: null,
    contactId: null,
  },
  capabilities: [] as string[],
  authContext: {
    principalId: null,
    principalAliases: [],
    population: "workforce" as const,
    platformRole: null,
    isSuperuser: false,
    employeeId: "emp_1",
    managerScope: null,
    teamIds: [],
    accountScope: { accountIds: [], contactIds: [], partnerAccountIds: [] },
    sensitivityClearance: ["public" as const],
    authentication: {
      source: "session" as const,
      methods: [],
      contextClassReference: null,
    },
    actingHumanUserId: "user_1",
    actingAgentId: null,
    delegationGrantIds: [],
    grantedCapabilities: [] as string[],
  },
};

const PHOTO = {
  fileId: "media_abc",
  url: "/api/v1/media/media_abc",
  capturedAt: "2026-06-18T14:00:00.000Z",
};

function req(body: unknown): Request {
  return new Request("https://example/api/v1/work-items/WI-1/evidence", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}
const PARAMS = { params: Promise.resolve({ itemId: "WI-1" }) };

beforeEach(() => {
  mockAuth.mockReset();
  mockFindUnique.mockReset();
  mockUpdate.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/v1/work-items/:itemId/evidence", () => {
  it("rejects unauthenticated callers", async () => {
    mockAuth.mockRejectedValueOnce(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );
    const res = await POST(req({ photo: PHOTO }), PARAMS);
    expect(res.status).toBe(401);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("returns 422 when the photo payload is missing or malformed", async () => {
    mockAuth.mockResolvedValueOnce(USER);
    const res = await POST(req({}), PARAMS);
    expect(res.status).toBe(422);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("returns 422 when capturedAt is not a valid date", async () => {
    mockAuth.mockResolvedValueOnce(USER);
    const res = await POST(
      req({ photo: { ...PHOTO, capturedAt: "soon" } }),
      PARAMS,
    );
    expect(res.status).toBe(422);
  });

  it("returns 404 when the work item does not exist", async () => {
    mockAuth.mockResolvedValueOnce(USER);
    mockFindUnique.mockResolvedValueOnce(null);
    const res = await POST(req({ photo: PHOTO }), PARAMS);
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is not the assignee", async () => {
    mockAuth.mockResolvedValueOnce(USER);
    mockFindUnique.mockResolvedValueOnce({
      id: "wi_1",
      assignedToUserId: "u_someone_else",
      evidence: null,
    });
    const res = await POST(req({ photo: PHOTO }), PARAMS);
    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("appends the photo to existing evidence and returns the merged record", async () => {
    mockAuth.mockResolvedValueOnce(USER);
    const existing = {
      photos: [
        {
          fileId: "media_first",
          url: "/api/v1/media/media_first",
          capturedAt: "2026-06-18T13:30:00.000Z",
        },
      ],
    };
    mockFindUnique.mockResolvedValueOnce({
      id: "wi_1",
      assignedToUserId: USER.user.id,
      evidence: existing,
    });
    mockUpdate.mockResolvedValueOnce({});

    const res = await POST(req({ photo: PHOTO }), PARAMS);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { evidence: { photos: unknown[] } };
    expect(body.evidence.photos).toHaveLength(2);

    // The persisted payload must carry both photos, not just the new one.
    const persisted = mockUpdate.mock.calls[0][0].data.evidence as {
      photos: { fileId: string }[];
    };
    expect(persisted.photos.map((p) => p.fileId)).toEqual([
      "media_first",
      PHOTO.fileId,
    ]);
  });

  it("treats a null `evidence` column as empty before appending", async () => {
    mockAuth.mockResolvedValueOnce(USER);
    mockFindUnique.mockResolvedValueOnce({
      id: "wi_1",
      assignedToUserId: USER.user.id,
      evidence: null,
    });
    mockUpdate.mockResolvedValueOnce({});

    const res = await POST(req({ photo: PHOTO }), PARAMS);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { evidence: { photos: unknown[] } };
    expect(body.evidence.photos).toHaveLength(1);
  });
});
