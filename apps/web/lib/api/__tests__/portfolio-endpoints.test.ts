import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing route handlers
// ---------------------------------------------------------------------------

vi.mock("@dpf/db", () => ({
  prisma: {
    portfolio: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    digitalProduct: {
      findMany: vi.fn(),
    },
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

import { GET as treeHandler } from "../../../app/api/v1/portfolio/tree/route.js";
import { GET as detailHandler } from "../../../app/api/v1/portfolio/[id]/route.js";
import { GET as productsHandler } from "../../../app/api/v1/portfolio/[id]/products/route.js";

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
  capabilities: ["view_admin", "view_portfolio"],
};

const MOCK_PORTFOLIO = {
  id: "port-1",
  slug: "foundational",
  name: "Foundational",
  description: "Core platform services",
  budgetKUsd: 2500,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-03-19"),
  products: [
    {
      id: "prod-1",
      productId: "DPF-001",
      name: "Identity Service",
      lifecycleStage: "production",
      lifecycleStatus: "active",
    },
  ],
  epicPortfolios: [{ epicId: "epic-1" }],
};

function getRequest(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, {
    method: "GET",
    headers: { authorization: "Bearer valid-jwt", ...headers },
  });
}

// NextRequest-like object with nextUrl for the products route
function nextRequest(path: string): {
  url: string;
  method: string;
  headers: Headers;
  nextUrl: URL;
} {
  const url = `http://localhost${path}`;
  return {
    url,
    method: "GET",
    headers: new Headers({ authorization: "Bearer valid-jwt" }),
    nextUrl: new URL(url),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// PORTFOLIO TREE
// ===========================================================================
describe("GET /api/v1/portfolio/tree", () => {
  it("returns portfolio tree", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.portfolio.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      MOCK_PORTFOLIO,
      {
        id: "port-2",
        slug: "for_employees",
        name: "For Employees",
        description: "Employee-facing tools",
        budgetKUsd: 1000,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-03-19"),
        products: [],
        epicPortfolios: [],
      },
    ]);

    const req = getRequest("/api/v1/portfolio/tree");
    const res = await treeHandler(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.portfolios).toBeInstanceOf(Array);
    expect(body.portfolios.length).toBe(2);
    expect(body.portfolios[0].slug).toBe("foundational");
    expect(body.portfolios[0].products.length).toBe(1);
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const req = getRequest("/api/v1/portfolio/tree");
    const res = await treeHandler(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("UNAUTHENTICATED");
  });
});

// ===========================================================================
// PORTFOLIO DETAIL
// ===========================================================================
describe("GET /api/v1/portfolio/:id", () => {
  it("returns portfolio details", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.portfolio.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...MOCK_PORTFOLIO,
      products: [
        {
          id: "prod-1",
          productId: "DPF-001",
          name: "Identity Service",
          description: "Auth and identity",
          lifecycleStage: "production",
          lifecycleStatus: "active",
          version: "2.1.0",
          createdAt: new Date("2026-01-01"),
          updatedAt: new Date("2026-03-19"),
        },
      ],
    });

    const req = getRequest("/api/v1/portfolio/port-1");
    const res = await detailHandler(
      req as unknown as import("next/server").NextRequest,
      { params: Promise.resolve({ id: "port-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe("port-1");
    expect(body.slug).toBe("foundational");
    expect(body.products.length).toBe(1);
    expect(body.epicPortfolios.length).toBe(1);
  });

  it("returns 404 for nonexistent portfolio", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.portfolio.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const req = getRequest("/api/v1/portfolio/nonexistent");
    const res = await detailHandler(
      req as unknown as import("next/server").NextRequest,
      { params: Promise.resolve({ id: "nonexistent" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const req = getRequest("/api/v1/portfolio/port-1");
    const res = await detailHandler(
      req as unknown as import("next/server").NextRequest,
      { params: Promise.resolve({ id: "port-1" }) },
    );

    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// PORTFOLIO PRODUCTS
// ===========================================================================
describe("GET /api/v1/portfolio/:id/products", () => {
  it("returns paginated product list", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.portfolio.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "port-1" });
    (prisma.digitalProduct.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "prod-1",
        productId: "DPF-001",
        name: "Identity Service",
        description: "Auth and identity",
        lifecycleStage: "production",
        lifecycleStatus: "active",
        version: "2.1.0",
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-03-19"),
      },
      {
        id: "prod-2",
        productId: "DPF-002",
        name: "Notification Hub",
        description: "Push and email notifications",
        lifecycleStage: "build",
        lifecycleStatus: "active",
        version: "1.0.0",
        createdAt: new Date("2026-02-01"),
        updatedAt: new Date("2026-03-19"),
      },
    ]);

    const req = nextRequest("/api/v1/portfolio/port-1/products?limit=10");
    const res = await productsHandler(
      req as unknown as import("next/server").NextRequest,
      { params: Promise.resolve({ id: "port-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBe(2);
    expect(body.data[0].name).toBe("Identity Service");
    expect(body.nextCursor).toBeNull();
  });

  it("returns 404 when portfolio does not exist", async () => {
    (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
    (prisma.portfolio.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const req = nextRequest("/api/v1/portfolio/nonexistent/products");
    const res = await productsHandler(
      req as unknown as import("next/server").NextRequest,
      { params: Promise.resolve({ id: "nonexistent" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 401 when unauthenticated", async () => {
    const { ApiError } = await import("../../api/error.js");
    (authenticateRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Authentication required", 401),
    );

    const req = nextRequest("/api/v1/portfolio/port-1/products");
    const res = await productsHandler(
      req as unknown as import("next/server").NextRequest,
      { params: Promise.resolve({ id: "port-1" }) },
    );

    expect(res.status).toBe(401);
  });
});
