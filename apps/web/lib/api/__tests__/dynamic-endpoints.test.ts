import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../api/auth-middleware.js", () => ({
  authenticateRequest: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { authenticateRequest } from "../../api/auth-middleware.js";

import { GET as formsListHandler } from "../../../app/api/v1/dynamic/forms/route.js";
import { GET as formDetailHandler } from "../../../app/api/v1/dynamic/forms/[id]/route.js";
import { POST as formSubmitHandler } from "../../../app/api/v1/dynamic/forms/[id]/submit/route.js";
import { GET as viewsListHandler } from "../../../app/api/v1/dynamic/views/route.js";
import { GET as viewDataHandler } from "../../../app/api/v1/dynamic/views/[id]/data/route.js";
import { POST as uploadHandler } from "../../../app/api/v1/upload/route.js";

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

function postRequest(path: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { authorization: "Bearer valid-jwt", "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// DYNAMIC FORMS — STUBS
// ===========================================================================
describe("GET /api/v1/dynamic/forms", () => {
  it("returns empty list", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);

    const res = await formsListHandler(getRequest("/api/v1/dynamic/forms"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const res = await formsListHandler(getRequest("/api/v1/dynamic/forms"));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/v1/dynamic/forms/:id", () => {
  it("returns 404 NOT_IMPLEMENTED", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);

    const res = await formDetailHandler(
      getRequest("/api/v1/dynamic/forms/form-1"),
      { params: Promise.resolve({ id: "form-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe("NOT_IMPLEMENTED");
  });
});

describe("POST /api/v1/dynamic/forms/:id/submit", () => {
  it("returns 404 NOT_IMPLEMENTED", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);

    const res = await formSubmitHandler(
      postRequest("/api/v1/dynamic/forms/form-1/submit"),
      { params: Promise.resolve({ id: "form-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe("NOT_IMPLEMENTED");
  });
});

// ===========================================================================
// DYNAMIC VIEWS — STUBS
// ===========================================================================
describe("GET /api/v1/dynamic/views", () => {
  it("returns empty list", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);

    const res = await viewsListHandler(getRequest("/api/v1/dynamic/views"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });
});

describe("GET /api/v1/dynamic/views/:id/data", () => {
  it("returns 404 NOT_IMPLEMENTED", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);

    const res = await viewDataHandler(
      getRequest("/api/v1/dynamic/views/view-1/data"),
      { params: Promise.resolve({ id: "view-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe("NOT_IMPLEMENTED");
  });
});

// ===========================================================================
// UPLOAD
// ===========================================================================
describe("POST /api/v1/upload", () => {
  it("accepts valid file upload", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);

    const file = new File(["hello world"], "test.pdf", { type: "application/pdf" });
    const formData = new FormData();
    formData.append("file", file);

    const req = new Request("http://localhost/api/v1/upload", {
      method: "POST",
      headers: { authorization: "Bearer valid-jwt" },
      body: formData,
    });

    const res = await uploadHandler(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.fileId).toBeDefined();
    expect(body.url).toMatch(/^\/uploads\//);
  });

  it("rejects file exceeding 10MB", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);

    // Create a file > 10MB
    const bigContent = new Uint8Array(11 * 1024 * 1024);
    const file = new File([bigContent], "large.pdf", { type: "application/pdf" });
    const formData = new FormData();
    formData.append("file", file);

    const req = new Request("http://localhost/api/v1/upload", {
      method: "POST",
      headers: { authorization: "Bearer valid-jwt" },
      body: formData,
    });

    const res = await uploadHandler(req);
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.code).toBe("FILE_TOO_LARGE");
  });

  it("rejects invalid MIME type", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);

    const file = new File(["hello"], "test.txt", { type: "text/plain" });
    const formData = new FormData();
    formData.append("file", file);

    const req = new Request("http://localhost/api/v1/upload", {
      method: "POST",
      headers: { authorization: "Bearer valid-jwt" },
      body: formData,
    });

    const res = await uploadHandler(req);
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.code).toBe("INVALID_FILE_TYPE");
  });

  it("returns 422 when no file provided", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);

    const formData = new FormData();
    const req = new Request("http://localhost/api/v1/upload", {
      method: "POST",
      headers: { authorization: "Bearer valid-jwt" },
      body: formData,
    });

    const res = await uploadHandler(req);
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const formData = new FormData();
    const req = new Request("http://localhost/api/v1/upload", {
      method: "POST",
      headers: { authorization: "Bearer valid-jwt" },
      body: formData,
    });

    const res = await uploadHandler(req);
    expect(res.status).toBe(401);
  });
});
