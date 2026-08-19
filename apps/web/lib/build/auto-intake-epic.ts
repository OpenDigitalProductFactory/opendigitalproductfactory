// apps/web/lib/build/auto-intake-epic.ts
//
// Request-scope-INDEPENDENT epic creation for Build Studio auto-intake.
//
// Why this exists: reviewDesignDoc's ideate auto-intake runs in TWO contexts —
// interactive chat (Next.js request scope present) AND the autonomous resume
// path (instrumentation.ts setInterval -> resumePreBuildPhase -> executeTool
// reviewDesignDoc), which has NO request scope. The original code called the
// createBuildEpic SERVER ACTION, whose requireBuildAccess -> requireCapability
// -> headers() throws "called outside a request scope" in the autonomous path.
// The auto-intake catch swallowed it, epicId stayed null, and the ideate->plan
// gate blocked on "Missing: epic" forever (the janitor re-failing every ~10 min
// and burning cloud review spend — observed live on FB-673BF54B).
//
// This helper takes an injected Prisma client and does a pure DB write, so it
// works identically in both contexts. Auth is enforced by the CALLER (the
// server action still gates; the autonomous path already resolved its actor).
// Keeping it db-injected also makes the request-scope-independence unit-testable
// without a running Next.js request.

import crypto from "crypto";

/** Minimal transactional surface this helper needs — satisfied by PrismaClient
 *  and by a `$transaction` tx client alike, and trivially faked in tests. */
export type EpicCreateDb = {
  epic: {
    create(args: {
      data: { epicId: string; title: string; status: string };
      select: { id: true; epicId: true };
    }): Promise<{ id: string; epicId: string }>;
  };
  portfolio: {
    findUnique(args: {
      where: { slug: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
  epicPortfolio: {
    create(args: { data: { epicId: string; portfolioId: string } }): Promise<unknown>;
  };
};

export type AutoCreateBuildEpicInput = {
  db: EpicCreateDb;
  title: string;
  portfolioSlug?: string | null;
  /** Injectable id generator (tests pass a deterministic one). */
  generateEpicId?: () => string;
  logger?: Pick<Console, "warn">;
};

export function defaultBuildEpicId(): string {
  return `EP-BUILD-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

/**
 * Create an Epic (and optionally link it to a portfolio) for a Build Studio
 * build, using only the injected Prisma client — NEVER Next.js request APIs.
 * Returns the created row's semantic epicId + cuid. Portfolio-link failures are
 * non-fatal (logged, epic still returned), matching prior behavior.
 */
export async function autoCreateBuildEpic(
  input: AutoCreateBuildEpicInput,
): Promise<{ id: string; epicId: string }> {
  const logger = input.logger ?? console;
  const epicId = (input.generateEpicId ?? defaultBuildEpicId)();
  const epicRow = await input.db.epic.create({
    data: { epicId, title: input.title, status: "open" },
    select: { id: true, epicId: true },
  });
  if (input.portfolioSlug) {
    try {
      const portfolio = await input.db.portfolio.findUnique({
        where: { slug: input.portfolioSlug },
        select: { id: true },
      });
      if (portfolio) {
        await input.db.epicPortfolio.create({
          data: { epicId: epicRow.id, portfolioId: portfolio.id },
        });
      }
    } catch (e) {
      logger.warn("[autoCreateBuildEpic] portfolio link failed:", e);
    }
  }
  return epicRow;
}
