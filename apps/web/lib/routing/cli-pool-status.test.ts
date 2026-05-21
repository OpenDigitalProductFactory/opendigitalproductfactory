import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Prisma ──────────────────────────────────────────────────────────────
vi.mock("@dpf/db", () => {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    prisma: {
      cliPoolStatus: {
        upsert: vi.fn(async ({ where, create, update }: { where: { adapterType: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          const existing = rows.get(where.adapterType);
          const row = existing ? { ...existing, ...update } : { ...create };
          rows.set(where.adapterType, row);
          return row;
        }),
        findUnique: vi.fn(async ({ where }: { where: { adapterType: string } }) => {
          return rows.get(where.adapterType) ?? null;
        }),
        findMany: vi.fn(async () => [...rows.values()]),
        deleteMany: vi.fn(async ({ where }: { where: { adapterType: string } }) => {
          rows.delete(where.adapterType);
          return { count: 1 };
        }),
        _rows: rows,
      },
    },
  };
});

import {
  parseRetryAfterSeconds,
  recordCliRateLimit,
  getCliPoolStatus,
  getAllCliPoolStatuses,
  clearCliRateLimit,
} from "./cli-pool-status";
import { prisma } from "@dpf/db";

// Helper to reset the in-memory rows map between tests
function clearMockRows() {
  // @ts-expect-error accessing test-only _rows
  (prisma.cliPoolStatus._rows as Map<string, unknown>).clear();
}

describe("parseRetryAfterSeconds", () => {
  it("parses Retry-After: <seconds> header", () => {
    expect(parseRetryAfterSeconds("Retry-After: 30")).toBe(30);
    expect(parseRetryAfterSeconds("retry-after: 120")).toBe(120);
  });

  it("parses X-RateLimit-Reset epoch header", () => {
    const futureEpoch = Math.floor(Date.now() / 1000) + 60;
    const result = parseRetryAfterSeconds(`X-RateLimit-Reset: ${futureEpoch}`);
    // Should be within ±2s of 60
    expect(result).toBeGreaterThan(55);
    expect(result).toBeLessThanOrEqual(62);
  });

  it("parses 'N seconds' from error message body", () => {
    expect(parseRetryAfterSeconds("Rate limit exceeded. Please wait 45 seconds.")).toBe(45);
    expect(parseRetryAfterSeconds("try again in 10 seconds")).toBe(10);
  });

  it("returns null for unparseable input", () => {
    expect(parseRetryAfterSeconds("rate limited")).toBeNull();
    expect(parseRetryAfterSeconds("429 Too Many Requests")).toBeNull();
    expect(parseRetryAfterSeconds("")).toBeNull();
  });
});

describe("recordCliRateLimit", () => {
  beforeEach(() => {
    clearMockRows();
    vi.clearAllMocks();
  });

  it("writes a CliPoolStatus row on first call", async () => {
    await recordCliRateLimit("claude-cli", "anthropic-sub", "rate limited: Retry-After: 60");
    expect(prisma.cliPoolStatus.upsert).toHaveBeenCalledOnce();

    const status = await getCliPoolStatus("claude-cli");
    expect(status).not.toBeNull();
    expect(status!.adapterType).toBe("claude-cli");
    expect(status!.retryAfterSeconds).toBe(60);
    expect(status!.isExhausted).toBe(true);
  });

  it("upserts — overwrites existing row on second 429", async () => {
    await recordCliRateLimit("claude-cli", "anthropic-sub", "rate limited: Retry-After: 30");
    await recordCliRateLimit("claude-cli", "anthropic-sub", "rate limited: Retry-After: 120");
    expect(prisma.cliPoolStatus.upsert).toHaveBeenCalledTimes(2);

    const status = await getCliPoolStatus("claude-cli");
    expect(status!.retryAfterSeconds).toBe(120);
  });

  it("truncates errorSnippet to 300 characters", async () => {
    const longError = "x".repeat(400);
    await recordCliRateLimit("codex-cli", "chatgpt", longError);
    const status = await getCliPoolStatus("codex-cli");
    expect(status!.errorSnippet).toHaveLength(300);
  });

  it("handles missing Retry-After gracefully (resetAt is null)", async () => {
    await recordCliRateLimit("claude-cli", "anthropic-sub", "rate limit hit");
    const status = await getCliPoolStatus("claude-cli");
    expect(status!.resetAt).toBeNull();
    expect(status!.isExhausted).toBe(false); // no reset time means we don't know — not blocking
  });

  it("swallows db errors without throwing", async () => {
    vi.mocked(prisma.cliPoolStatus.upsert).mockRejectedValueOnce(new Error("db down"));
    await expect(
      recordCliRateLimit("claude-cli", "anthropic-sub", "rate limited"),
    ).resolves.not.toThrow();
  });
});

describe("getCliPoolStatus", () => {
  beforeEach(() => {
    clearMockRows();
    vi.clearAllMocks();
  });

  it("returns null when no rate-limit recorded for that adapter", async () => {
    const status = await getCliPoolStatus("claude-cli");
    expect(status).toBeNull();
  });

  it("computes isExhausted=true when resetAt is in the future", async () => {
    await recordCliRateLimit("claude-cli", "anthropic-sub", "Retry-After: 300");
    const status = await getCliPoolStatus("claude-cli");
    expect(status!.isExhausted).toBe(true);
    expect(status!.secondsUntilReset).toBeGreaterThan(290);
  });

  it("computes isExhausted=false when resetAt is null", async () => {
    await recordCliRateLimit("claude-cli", "anthropic-sub", "rate limited");
    const status = await getCliPoolStatus("claude-cli");
    expect(status!.isExhausted).toBe(false);
    expect(status!.secondsUntilReset).toBeNull();
  });

  it("swallows db errors and returns null", async () => {
    vi.mocked(prisma.cliPoolStatus.findUnique).mockRejectedValueOnce(new Error("db down"));
    await expect(getCliPoolStatus("claude-cli")).resolves.toBeNull();
  });
});

describe("getAllCliPoolStatuses", () => {
  beforeEach(() => {
    clearMockRows();
    vi.clearAllMocks();
  });

  it("returns empty array when no entries exist", async () => {
    const statuses = await getAllCliPoolStatuses();
    expect(statuses).toEqual([]);
  });

  it("returns all recorded adapters", async () => {
    await recordCliRateLimit("claude-cli", "anthropic-sub", "Retry-After: 60");
    await recordCliRateLimit("codex-cli", "chatgpt", "rate limited");
    const statuses = await getAllCliPoolStatuses();
    expect(statuses).toHaveLength(2);
    expect(statuses.map((s) => s.adapterType).sort()).toEqual(["claude-cli", "codex-cli"]);
  });
});

describe("clearCliRateLimit", () => {
  beforeEach(() => {
    clearMockRows();
    vi.clearAllMocks();
  });

  it("removes the row so subsequent getCliPoolStatus returns null", async () => {
    await recordCliRateLimit("claude-cli", "anthropic-sub", "Retry-After: 60");
    await clearCliRateLimit("claude-cli");
    const status = await getCliPoolStatus("claude-cli");
    expect(status).toBeNull();
  });

  it("swallows db errors without throwing", async () => {
    vi.mocked(prisma.cliPoolStatus.deleteMany).mockRejectedValueOnce(new Error("db down"));
    await expect(clearCliRateLimit("claude-cli")).resolves.not.toThrow();
  });
});
