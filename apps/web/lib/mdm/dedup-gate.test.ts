import { beforeEach, describe, expect, it, vi } from "vitest";

// The candidate lookups now run inside runHeapForcedCandidateQuery, which opens
// a $transaction and sets the heap-forcing planner GUCs before the query
// (BI-FEAEB715). The mock threads the same $queryRaw mock through as the tx so
// these unit tests keep asserting on the query, and records the GUC statements
// so a test can prove the heap-forcing fired. vi.hoisted keeps the fns available
// to the hoisted vi.mock factory without a temporal-dead-zone error.
const db = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  executeRawUnsafe: vi.fn(async (_sql: string) => 0),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    $queryRaw: db.queryRaw,
    $executeRawUnsafe: db.executeRawUnsafe,
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({ $queryRaw: db.queryRaw, $executeRawUnsafe: db.executeRawUnsafe }),
    ),
  },
}));
const executeRawUnsafe = db.executeRawUnsafe;

import { prisma } from "@dpf/db";
import {
  GATED_CREATE_PATHS,
  parseDedupResolution,
  checkCustomerAccountDuplicates,
  checkCustomerContactDuplicates,
  checkCustomerSiteDuplicates,
  customerAccountNormalizedColumns,
  customerContactNormalizedColumns,
  customerSiteNormalizedColumns,
  resolveDedupDecision,
  type DedupCheckResult,
} from "./dedup-gate";

const queryRaw = vi.mocked(prisma.$queryRaw);

beforeEach(() => {
  queryRaw.mockReset();
});

describe("checkCustomerAccountDuplicates", () => {
  it("returns clear when no candidates survive scoring", async () => {
    queryRaw.mockResolvedValue([]);
    const result = await checkCustomerAccountDuplicates({ name: "Riverside Medical" });
    expect(result).toEqual({ verdict: "clear", candidates: [] });
  });

  it("flags the Emma3D near-duplicate as likely-duplicate with reasons", async () => {
    queryRaw.mockResolvedValue([
      {
        id: "acct-1",
        name: "Emma3D",
        status: "prospect",
        website: null,
        nameNormalized: "emma3d",
        domainNormalized: "",
      },
    ]);
    const result = await checkCustomerAccountDuplicates({ name: "Emma 3D" });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.id).toBe("acct-1");
    // "emma 3d" vs "emma3d" is a strong-but-not-exact normalized-name match:
    // it must at least surface as a possible duplicate — never silently clear.
    expect(result.verdict === "likely-duplicate" || result.verdict === "possible-duplicate").toBe(
      true,
    );
    expect(result.candidates[0]?.reasons.some((r) => r.attribute === "name")).toBe(true);
  });

  it("treats exact normalized name + shared domain as likely-duplicate", async () => {
    queryRaw.mockResolvedValue([
      {
        id: "acct-2",
        name: "Managing Digital Ltd",
        status: "active",
        website: "https://managingdigital.co.uk",
        nameNormalized: "managing digital",
        domainNormalized: "managingdigital.co.uk",
      },
    ]);
    const result = await checkCustomerAccountDuplicates({
      name: "Managing Digital",
      website: "managingdigital.co.uk",
    });
    expect(result.verdict).toBe("likely-duplicate");
    expect(result.candidates[0]?.reasons.map((r) => r.attribute)).toEqual(
      expect.arrayContaining(["domain", "name"]),
    );
  });

  it("skips the query entirely when the subject has no usable identity signal", async () => {
    const result = await checkCustomerAccountDuplicates({ name: "   " });
    expect(result.verdict).toBe("clear");
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe("checkCustomerContactDuplicates", () => {
  it("surfaces a same-email contact as likely-duplicate", async () => {
    queryRaw.mockResolvedValue([
      {
        id: "ct-1",
        email: "ian@emma3d.co.uk",
        firstName: "Ian",
        lastName: "Smith",
        name: null,
        phone: null,
        accountId: "acct-1",
      },
    ]);
    const result = await checkCustomerContactDuplicates({
      firstName: "Ian",
      lastName: "Smith",
      email: "ian@emma3d.co.uk",
    });
    expect(result.verdict).toBe("likely-duplicate");
  });

  it("returns clear for an empty subject without querying", async () => {
    const result = await checkCustomerContactDuplicates({});
    expect(result.verdict).toBe("clear");
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe("checkCustomerSiteDuplicates", () => {
  it("flags a same-account fuzzy site name", async () => {
    queryRaw.mockResolvedValue([
      { id: "site-1", name: "Head Office", status: "active", nameNormalized: "head office" },
    ]);
    const result = await checkCustomerSiteDuplicates({
      accountId: "acct-1",
      name: "Head Office.",
    });
    expect(result.verdict).toBe("likely-duplicate");
    expect(result.candidates[0]?.id).toBe("site-1");
  });
});

describe("resolveDedupDecision (gate contract)", () => {
  const likely: DedupCheckResult = {
    verdict: "likely-duplicate",
    candidates: [
      {
        id: "acct-1",
        label: "Emma3D",
        detail: "prospect",
        score: 0.9,
        reasons: [],
        recommendation: "likely-duplicate",
      },
    ],
  };
  const possible: DedupCheckResult = { ...likely, verdict: "possible-duplicate" };
  const clear: DedupCheckResult = { verdict: "clear", candidates: [] };

  it("clear → proceed without any resolution", () => {
    expect(resolveDedupDecision(clear, undefined)).toEqual({ action: "proceed" });
  });

  it("likely-duplicate without resolution → needs-resolution (blocked)", () => {
    expect(resolveDedupDecision(likely, undefined)).toEqual({
      action: "needs-resolution",
      result: likely,
    });
  });

  it("possible-duplicate without resolution → needs-resolution (alert)", () => {
    expect(resolveDedupDecision(possible, undefined).action).toBe("needs-resolution");
  });

  it("confirm-new overrides with the reason carried through", () => {
    expect(resolveDedupDecision(likely, { kind: "confirm-new", reason: "different company" })).toEqual(
      { action: "proceed", overrideReason: "different company" },
    );
  });

  it("use-existing wins regardless of verdict and never inserts", () => {
    expect(resolveDedupDecision(clear, { kind: "use-existing", existingId: "acct-9" })).toEqual({
      action: "use-existing",
      existingId: "acct-9",
    });
  });
});

describe("normalized-column helpers", () => {
  it("normalizes account name + website domain", () => {
    expect(
      customerAccountNormalizedColumns({
        name: "Managing Digital Ltd.",
        website: "https://www.ManagingDigital.co.uk/about",
      }),
    ).toEqual({ nameNormalized: "managing digital", domainNormalized: "managingdigital.co.uk" });
  });

  it("normalizes site and contact names", () => {
    expect(customerSiteNormalizedColumns({ name: "Head-Office" })).toEqual({
      nameNormalized: "head office",
    });
    expect(
      customerContactNormalizedColumns({ firstName: "Ian", lastName: "O'Brien" }),
    ).toEqual({ nameNormalized: "ian o brien" });
    expect(customerContactNormalizedColumns({ name: "Legacy Name" })).toEqual({
      nameNormalized: "legacy name",
    });
  });
});

describe("GATED_CREATE_PATHS registry", () => {
  it("covers the three gated domains with at least one path each", () => {
    expect(Object.keys(GATED_CREATE_PATHS).sort()).toEqual([
      "customer-account",
      "customer-contact",
      "customer-site",
    ]);
    for (const paths of Object.values(GATED_CREATE_PATHS)) {
      expect(paths.length).toBeGreaterThan(0);
    }
  });
});

describe("parseDedupResolution", () => {
  it("parses use-existing with id", () => {
    expect(parseDedupResolution({ duplicateResolution: "use-existing:abc" })).toEqual({
      kind: "use-existing",
      existingId: "abc",
    });
  });
  it("parses confirm-new with reason", () => {
    expect(
      parseDedupResolution({ duplicateResolution: "confirm-new", duplicateReason: "different co" }),
    ).toEqual({ kind: "confirm-new", reason: "different co" });
  });
  it("returns undefined for absent or malformed input", () => {
    expect(parseDedupResolution({})).toBeUndefined();
    expect(parseDedupResolution(null)).toBeUndefined();
    expect(parseDedupResolution({ duplicateResolution: "use-existing:" })).toBeUndefined();
    expect(parseDedupResolution({ duplicateResolution: "bogus" })).toBeUndefined();
  });
});

describe("heap-forced candidate lookup (BI-FEAEB715 — collation-drift immunity)", () => {
  it("disables all three index-scan classes before every candidate query", async () => {
    executeRawUnsafe.mockClear();
    queryRaw.mockResolvedValue([]);
    await checkCustomerContactDuplicates({ email: "a@b.com" });
    const guc = executeRawUnsafe.mock.calls.map((c) => c[0]);
    expect(guc).toContain("SET LOCAL enable_indexscan = off");
    expect(guc).toContain("SET LOCAL enable_indexonlyscan = off");
    expect(guc).toContain("SET LOCAL enable_bitmapscan = off");
  });

  it("forces the heap for an exact-only (email) check — the previously exposed arm", async () => {
    executeRawUnsafe.mockClear();
    queryRaw.mockResolvedValue([]);
    // No name, so the collation-immune similarity arm never runs; only the
    // exact email btree arm would — this is exactly the check that was unsafe.
    await checkCustomerContactDuplicates({ email: "solo@example.com" });
    expect(executeRawUnsafe).toHaveBeenCalled();
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});
