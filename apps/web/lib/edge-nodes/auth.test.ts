import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    edgeNode: {
      findUnique: vi.fn(),
    },
    edgeNodeToken: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";

import { authenticateEdgeRequest } from "./auth";
import { EDGE_TOKEN_PREFIX } from "./tokens";

type Mock = ReturnType<typeof vi.fn>;

const nodeFindUnique = prisma.edgeNode.findUnique as unknown as Mock;
const tokenFindUnique = prisma.edgeNodeToken.findUnique as unknown as Mock;

function makeRequest(headers: Record<string, string>): import("next/server").NextRequest {
  return {
    headers: {
      get(name: string) {
        const lower = name.toLowerCase();
        for (const [k, v] of Object.entries(headers)) {
          if (k.toLowerCase() === lower) return v;
        }
        return null;
      },
    },
  } as unknown as import("next/server").NextRequest;
}

const goodToken = {
  id: "tok_1",
  edgeNodeId: "edge_db_1",
  revokedAt: null,
  rotatedAt: null,
  expiresAt: new Date(Date.now() + 60_000),
  scopes: ["edge:heartbeat", "discovery:submit"],
};

const goodNode = {
  id: "edge_db_1",
  nodeId: "edge_abc123",
  principalId: "principal_1",
  trustState: "trusted",
  status: "active",
};

beforeEach(() => {
  vi.resetAllMocks();
  // resolveNodeToken fires a lazy lastUsedAt update; mock returns a real
  // promise so the `.catch()` chain doesn't blow up.
  (prisma.edgeNodeToken.update as unknown as Mock).mockResolvedValue({});
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("authenticateEdgeRequest", () => {
  it("rejects requests without Authorization header", async () => {
    const result = await authenticateEdgeRequest(makeRequest({}), "edge:heartbeat");
    expect(result).toEqual({ ok: false, status: 401, error: "missing_bearer" });
  });

  it("rejects malformed Authorization header", async () => {
    const result = await authenticateEdgeRequest(
      makeRequest({ Authorization: "Basic abcd" }),
      "edge:heartbeat",
    );
    expect(result).toEqual({ ok: false, status: 401, error: "missing_bearer" });
  });

  it("rejects non-dpfedge_ bearer token (invalid_format)", async () => {
    const result = await authenticateEdgeRequest(
      makeRequest({ Authorization: "Bearer dpfmcp_AAAAAAAA" }),
      "edge:heartbeat",
    );
    expect(result).toEqual({ ok: false, status: 401, error: "invalid_format" });
  });

  it("rejects unknown token hash", async () => {
    tokenFindUnique.mockResolvedValue(null);
    const result = await authenticateEdgeRequest(
      makeRequest({ Authorization: `Bearer ${EDGE_TOKEN_PREFIX}AAAA` }),
      "edge:heartbeat",
    );
    expect(result).toEqual({ ok: false, status: 401, error: "not_found" });
  });

  it("rejects revoked tokens", async () => {
    tokenFindUnique.mockResolvedValue({ ...goodToken, revokedAt: new Date() });
    const result = await authenticateEdgeRequest(
      makeRequest({ Authorization: `Bearer ${EDGE_TOKEN_PREFIX}AAAA` }),
      "edge:heartbeat",
    );
    expect(result).toEqual({ ok: false, status: 401, error: "revoked" });
  });

  it("rejects expired tokens", async () => {
    tokenFindUnique.mockResolvedValue({
      ...goodToken,
      expiresAt: new Date(Date.now() - 1_000),
    });
    const result = await authenticateEdgeRequest(
      makeRequest({ Authorization: `Bearer ${EDGE_TOKEN_PREFIX}AAAA` }),
      "edge:heartbeat",
    );
    expect(result).toEqual({ ok: false, status: 401, error: "expired" });
  });

  it("rejects tokens whose EdgeNode row is missing", async () => {
    tokenFindUnique.mockResolvedValue(goodToken);
    nodeFindUnique.mockResolvedValue(null);
    const result = await authenticateEdgeRequest(
      makeRequest({ Authorization: `Bearer ${EDGE_TOKEN_PREFIX}AAAA` }),
      "edge:heartbeat",
    );
    expect(result).toEqual({ ok: false, status: 401, error: "node_not_found" });
  });

  it("rejects revoked nodes", async () => {
    tokenFindUnique.mockResolvedValue(goodToken);
    nodeFindUnique.mockResolvedValue({ ...goodNode, trustState: "revoked" });
    const result = await authenticateEdgeRequest(
      makeRequest({ Authorization: `Bearer ${EDGE_TOKEN_PREFIX}AAAA` }),
      "edge:heartbeat",
    );
    expect(result).toEqual({ ok: false, status: 401, error: "node_revoked" });
  });

  it("rejects quarantined nodes on discovery:submit (403)", async () => {
    tokenFindUnique.mockResolvedValue(goodToken);
    nodeFindUnique.mockResolvedValue({ ...goodNode, trustState: "quarantined" });
    const result = await authenticateEdgeRequest(
      makeRequest({ Authorization: `Bearer ${EDGE_TOKEN_PREFIX}AAAA` }),
      "discovery:submit",
    );
    expect(result).toEqual({ ok: false, status: 403, error: "node_quarantined" });
  });

  it("allows quarantined nodes to call edge:heartbeat (so operator can see liveness)", async () => {
    tokenFindUnique.mockResolvedValue(goodToken);
    nodeFindUnique.mockResolvedValue({ ...goodNode, trustState: "quarantined" });
    const result = await authenticateEdgeRequest(
      makeRequest({ Authorization: `Bearer ${EDGE_TOKEN_PREFIX}AAAA` }),
      "edge:heartbeat",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.trustState).toBe("quarantined");
    }
  });

  it("rejects when the token lacks the required scope (403)", async () => {
    tokenFindUnique.mockResolvedValue({
      ...goodToken,
      scopes: ["edge:heartbeat"],
    });
    nodeFindUnique.mockResolvedValue(goodNode);
    const result = await authenticateEdgeRequest(
      makeRequest({ Authorization: `Bearer ${EDGE_TOKEN_PREFIX}AAAA` }),
      "discovery:submit",
    );
    expect(result).toEqual({ ok: false, status: 403, error: "missing_scope" });
  });

  it("returns full context on success", async () => {
    tokenFindUnique.mockResolvedValue(goodToken);
    nodeFindUnique.mockResolvedValue(goodNode);
    const result = await authenticateEdgeRequest(
      makeRequest({ Authorization: `Bearer ${EDGE_TOKEN_PREFIX}AAAA` }),
      "discovery:submit",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context).toEqual({
        tokenId: "tok_1",
        edgeNodeId: "edge_db_1",
        nodeId: "edge_abc123",
        principalId: "principal_1",
        trustState: "trusted",
        status: "active",
        scopes: ["edge:heartbeat", "discovery:submit"],
      });
    }
  });
});
