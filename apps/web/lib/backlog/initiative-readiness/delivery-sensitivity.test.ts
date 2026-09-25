import { describe, expect, it } from "vitest";

import {
  assessDeliverySensitivity,
  classifyChangePath,
  extractCitedRepoPaths,
} from "./delivery-sensitivity";

// BI-243BC956: the sensitivity that raises a delivery shape is read from what
// the change touches, not from the words used to describe it (WWMD
// DI-52BAAB9E6835, substrate classes DI-B9DCC3F456F9).

describe("classifyChangePath — structural substrate only", () => {
  it.each([
    ["packages/db/prisma/schema.prisma", "elevated", "schema"],
    ["packages/db/prisma/migrations/20260925000000_x/migration.sql", "elevated", "migration"],
    ["apps/web/app/api/v1/invoices/route.ts", "elevated", "route"],
    ["apps/web/app/(shell)/finance/route.ts", "elevated", "route"],
    ["apps/web/lib/integrations/stripe/webhook-handler.ts", "elevated", "external-surface"],
    ["docker-compose.yml", "elevated", "external-surface"],
    ["apps/web/lib/auth.ts", "high", "access-control"],
    ["apps/web/lib/tak/initiative-readiness-tool-grants.ts", "high", "access-control"],
    ["apps/web/middleware.ts", "high", "access-control"],
    ["packages/db/data/agent_registry.json", "high", "access-control"],
  ])("%s is %s (%s)", (path, level, signal) => {
    expect(classifyChangePath(path)).toEqual({ level, signal });
  });

  it.each([
    "scripts/pregate.mjs",
    "scripts/lib/local-integration-ci.mjs",
    "apps/web/lib/actions/ap.ts",
    "apps/web/lib/finance/ai-provider-finance.ts",
    // A domain noun in a module name is not substrate (DI-B9DCC3F456F9).
    "apps/web/lib/finance/invoice-payment-refs.ts",
    // Tests and docs touch no runtime substrate, whatever they are named.
    "apps/web/lib/auth.test.ts",
    "docs/founder-kernel/wiki/principles/security-review.md",
  ])("%s touches no sensitive substrate", (path) => {
    expect(classifyChangePath(path)).toBeNull();
  });
});

describe("extractCitedRepoPaths", () => {
  it("reads repo paths out of prose, dropping line suffixes and import specifiers", () => {
    const text = [
      "Two copies remain: `apps/web/lib/actions/ap.ts:620` and `lib/finance/ai-provider-finance.ts:195`.",
      "Both import from `@/lib/finance/invoice-payment-refs` instead.",
      "The gate lives in scripts/pregate.mjs.",
    ].join("\n");
    expect(extractCitedRepoPaths(text)).toEqual([
      "apps/web/lib/actions/ap.ts",
      "lib/finance/ai-provider-finance.ts",
      "scripts/pregate.mjs",
    ]);
  });
});

// BI-1669E08A, verbatim in substance: a careful gate-defect write-up whose
// subject matter is infrastructure and security, delivered as two CLI modules.
const GATE_DEFECT_BODY = [
  "A host launch failure is not a verdict: 0xC0000142 means the infrastructure could not start git.",
  "The security of the gate record depends on telling infrastructure apart from a verdict.",
  "Fixed in `scripts/pregate.mjs` and `scripts/lib/local-integration-ci.mjs` plus their tests",
  "(`scripts/pregate.test.mjs`, `scripts/lib/local-integration-ci.test.mjs`).",
].join("\n");

// BI-7DCA6159: a 2-file import swap whose prose says payment and invoice.
const PAYMENT_REF_BODY = [
  "Two identical private copies of `generatePaymentRef` (PAY-YYYY-NNNN from `prisma.payment.count()`) still exist:",
  "- `apps/web/lib/actions/ap.ts:620` (used by the payment-run paths)",
  "- `apps/web/lib/finance/ai-provider-finance.ts:195`",
  "Both import it from `@/lib/finance/invoice-payment-refs`; the header of",
  "`apps/web/lib/finance/invoice-payment-refs.ts` stops mentioning the copies.",
].join("\n");

describe("assessDeliverySensitivity", () => {
  it("BI-1669E08A: sensitive-sounding prose over a CLI-module change is not raised", () => {
    const assessed = assessDeliverySensitivity({ title: "Gate launch failure outranks a PASS", body: GATE_DEFECT_BODY, workType: "bug" });
    expect(assessed).toEqual({ level: "low", trigger: null });
  });

  it("BI-7DCA6159: payment/invoice prose over a lib import swap is not raised", () => {
    const assessed = assessDeliverySensitivity({ title: "Consolidate generatePaymentRef copies", body: PAYMENT_REF_BODY, workType: "refactor" });
    expect(assessed).toEqual({ level: "low", trigger: null });
  });

  it("a change that touches sensitive substrate is raised, and cites the path that raised it", () => {
    const assessed = assessDeliverySensitivity({
      title: "Tidy a helper",
      body: "Rename a column in `packages/db/prisma/schema.prisma`.",
      workType: "bug",
    });
    expect(assessed).toEqual({
      level: "elevated",
      trigger: { signal: "schema", source: "item-body-paths", evidence: "packages/db/prisma/schema.prisma" },
    });
  });

  it("declared Workroom edit paths outrank the paths the body cites", () => {
    const assessed = assessDeliverySensitivity({
      title: "Tidy a helper",
      body: "Touches `scripts/pregate.mjs` only.",
      workType: "bug",
      declaredPaths: ["apps/web/lib/auth.ts", "scripts/pregate.mjs"],
    });
    expect(assessed).toEqual({
      level: "high",
      trigger: { signal: "access-control", source: "declared-scope", evidence: "apps/web/lib/auth.ts" },
    });
  });

  it("with no change fact at all, prose still raises — and says it was prose", () => {
    const assessed = assessDeliverySensitivity({ title: "Harden the payment flow", body: "No paths named yet.", workType: "bug" });
    expect(assessed).toEqual({
      level: "high",
      trigger: { signal: "keyword", source: "item-prose", evidence: "payment" },
    });
  });
});
