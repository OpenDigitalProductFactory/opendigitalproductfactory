import { describe, expect, it, vi } from "vitest";
import { autoCreateBuildEpic, type EpicCreateDb } from "./auto-intake-epic";

// BI-836C5243 regression: the Build Studio ideate auto-intake epic-create must be
// request-scope-INDEPENDENT. Previously it called the createBuildEpic server
// action, whose requireBuildAccess -> headers() threw "called outside a request
// scope" on the autonomous resume path, leaving epicId null and gate-blocking
// ad-hoc builds on "Missing: epic" forever. These tests pin the helper's pure-DB
// contract so a regression to a request-scoped call is caught in CI.

function makeDb(overrides: Partial<EpicCreateDb> = {}): EpicCreateDb {
  return {
    epic: {
      create: vi.fn(async () => ({ id: "cuid-epic-1", epicId: "EP-BUILD-ABC123" })),
    },
    portfolio: {
      findUnique: vi.fn(async () => ({ id: "cuid-portfolio-1" })),
    },
    epicPortfolio: {
      create: vi.fn(async () => ({})),
    },
    ...overrides,
  };
}

describe("autoCreateBuildEpic", () => {
  it("creates an epic via the injected prisma client without any request scope", async () => {
    const db = makeDb();
    const result = await autoCreateBuildEpic({
      db,
      title: "Greet me by my first name",
      generateEpicId: () => "EP-BUILD-ABC123",
    });

    expect(result).toEqual({ id: "cuid-epic-1", epicId: "EP-BUILD-ABC123" });
    expect(db.epic.create).toHaveBeenCalledWith({
      data: { epicId: "EP-BUILD-ABC123", title: "Greet me by my first name", status: "open" },
      select: { id: true, epicId: true },
    });
    // No portfolioSlug → no portfolio lookup/link.
    expect(db.portfolio.findUnique).not.toHaveBeenCalled();
    expect(db.epicPortfolio.create).not.toHaveBeenCalled();
  });

  it("links the epic to a portfolio when a slug resolves", async () => {
    const db = makeDb();
    await autoCreateBuildEpic({
      db,
      title: "Feature",
      portfolioSlug: "platform",
      generateEpicId: () => "EP-BUILD-ABC123",
    });

    expect(db.portfolio.findUnique).toHaveBeenCalledWith({
      where: { slug: "platform" },
      select: { id: true },
    });
    expect(db.epicPortfolio.create).toHaveBeenCalledWith({
      data: { epicId: "cuid-epic-1", portfolioId: "cuid-portfolio-1" },
    });
  });

  it("still returns the epic when the portfolio link fails (non-fatal)", async () => {
    const db = makeDb({
      epicPortfolio: {
        create: vi.fn(async () => {
          throw new Error("FK violation");
        }),
      },
    });
    const warn = vi.fn();
    const result = await autoCreateBuildEpic({
      db,
      title: "Feature",
      portfolioSlug: "platform",
      generateEpicId: () => "EP-BUILD-ABC123",
      logger: { warn },
    });

    expect(result.epicId).toBe("EP-BUILD-ABC123");
    expect(warn).toHaveBeenCalled();
  });

  it("does not link a portfolio when the slug does not resolve", async () => {
    const db = makeDb({
      portfolio: { findUnique: vi.fn(async () => null) },
    });
    await autoCreateBuildEpic({
      db,
      title: "Feature",
      portfolioSlug: "nonexistent",
      generateEpicId: () => "EP-BUILD-ABC123",
    });

    expect(db.epicPortfolio.create).not.toHaveBeenCalled();
  });
});
