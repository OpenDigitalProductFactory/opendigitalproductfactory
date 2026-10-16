import { describe, expect, it } from "vitest";

import { ACUMEN_ROOM_SHAPES } from "@/lib/work-management/acumen-room-shapes";
import { deriveImpactedAcumens } from "./acumen-impact";
import { PROFESSION_REGISTRY } from "./resolve-profession-profile";

// W16 (BI-18519A73). Pure classifier: first matching rule wins per path,
// union across paths, deduped, registry order, every key registry-validated.

describe("deriveImpactedAcumens", () => {
  it("includes UX prototypes and preserves architecture and supply-chain review coverage", () => {
    expect(deriveImpactedAcumens(["docs/ux-fit/prototype.html"])).toEqual(["ux-design"]);
    expect(deriveImpactedAcumens(["docs/ux-fit/review.md"])).toEqual(["ux-design"]);
    expect(deriveImpactedAcumens(["docs/architecture/interfaces.md"])).toEqual(["enterprise-architecture"]);
    expect(deriveImpactedAcumens(["pnpm-lock.yaml"])).toEqual(["release-service-management"]);
    expect(deriveImpactedAcumens(["packages/db/src/package.json"])).toEqual(["release-service-management"]);
  });
  it("recognizes a registered profession's own corpus without a resident-room entry", () => {
    expect(deriveImpactedAcumens(["docs/professions/finance/wiki/cash-position.md"])).toEqual(["finance"]);
  });

  it("recognizes an added registry family without a new path rule", () => {
    expect(deriveImpactedAcumens(["docs/professions/test-craft/wiki/practice.md"], [
      ...PROFESSION_REGISTRY.families,
      { professionKey: "test-craft" },
    ])).toEqual(["test-craft"]);
  });

  it("validates profession paths against the registry instead of trusting a path label", () => {
    expect(deriveImpactedAcumens(["docs/professions/unregistered-family/wiki/practice.md"])).toEqual([]);
  });

  it("does not treat a resident-room entry as proof that a profession is registered", () => {
    expect(deriveImpactedAcumens(["apps/web/components/Button.tsx"], [])).toEqual([]);
  });

  it("keeps corpus ownership ahead of incidental security keywords", () => {
    expect(deriveImpactedAcumens(["docs/professions/ux-design/wiki/authoring.md"])).toEqual(["ux-design"]);
  });

  it("normalizes Windows path separators and case before classifying", () => {
    expect(deriveImpactedAcumens([String.raw`APPS\WEB\LIB\MCP\pack.ts`])).toEqual(["mcp-integration"]);
  });

  it("returns [] for empty input", () => {
    expect(deriveImpactedAcumens([])).toEqual([]);
  });

  it("returns [] for paths matching no rule", () => {
    expect(deriveImpactedAcumens(["docs/readme.md", "README.md", "  "])).toEqual([]);
  });

  it("classifies data-architect surfaces", () => {
    expect(deriveImpactedAcumens(["packages/db/prisma/schema.prisma"])).toEqual(["data-architect"]);
    expect(
      deriveImpactedAcumens(["packages/db/prisma/migrations/20260816_x/migration.sql"]),
    ).toEqual(["data-architect"]);
    // packages/db/src wins over the generic packages-TS fallback.
    expect(deriveImpactedAcumens(["packages/db/src/wiki-taxonomy.ts"])).toEqual(["data-architect"]);
  });

  it("classifies ux-design surfaces", () => {
    expect(deriveImpactedAcumens(["apps/web/components/ui/Button.tsx"])).toEqual(["ux-design"]);
    expect(deriveImpactedAcumens(["apps/web/app/(shell)/build/page.tsx"])).toEqual(["ux-design"]);
    expect(deriveImpactedAcumens(["apps/web/app/globals.css"])).toEqual(["ux-design"]);
  });

  it("classifies mcp-integration ahead of the broader security and lib fallbacks", () => {
    // lib/mcp beats the generic apps/web/lib fallback.
    expect(deriveImpactedAcumens(["apps/web/lib/mcp/packs/foo-pack.ts"])).toEqual(["mcp-integration"]);
    // api/mcp beats app/api → security (rule order is load-bearing).
    expect(deriveImpactedAcumens(["apps/web/app/api/mcp/route.ts"])).toEqual(["mcp-integration"]);
    expect(deriveImpactedAcumens(["apps/web/app/api/a2a/route.ts"])).toEqual(["mcp-integration"]);
    expect(deriveImpactedAcumens(["apps/web/lib/integrate/adapter.ts"])).toEqual(["mcp-integration"]);
  });

  it("classifies security surfaces", () => {
    expect(deriveImpactedAcumens(["apps/web/app/api/users/route.ts"])).toEqual(["security"]);
    expect(deriveImpactedAcumens(["apps/web/middleware.ts"])).toEqual(["security"]);
    // lib/tak beats the generic apps/web/lib fallback.
    expect(deriveImpactedAcumens(["apps/web/lib/tak/agent-grants.ts"])).toEqual(["security"]);
  });

  it("classifies devops-platform surfaces", () => {
    expect(deriveImpactedAcumens(["scripts/deploy-local.sh"])).toEqual(["devops-platform"]);
    expect(deriveImpactedAcumens([".github/workflows/ci.yml"])).toEqual(["devops-platform"]);
    expect(deriveImpactedAcumens(["docker-compose.yml"])).toEqual(["devops-platform"]);
  });

  it("falls back to software-engineer for other platform TypeScript", () => {
    expect(deriveImpactedAcumens(["apps/web/lib/work-management/room-shapes.ts"])).toEqual([
      "software-engineer",
    ]);
    expect(deriveImpactedAcumens(["packages/kernel/src/index.ts"])).toEqual(["software-engineer"]);
  });

  it("dedupes and returns registry order regardless of input order", () => {
    const result = deriveImpactedAcumens([
      "scripts/reap.sh", // devops-platform
      "apps/web/lib/feature-build.ts", // software-engineer
      "apps/web/components/Card.tsx", // ux-design
      "packages/db/src/foo.ts", // data-architect
      "apps/web/lib/other.ts", // software-engineer (duplicate)
    ]);
    const registryOrder = ACUMEN_ROOM_SHAPES.map((entry) => entry.professionKey);
    expect(result).toEqual(
      registryOrder.filter((key) =>
        ["data-architect", "ux-design", "software-engineer", "devops-platform"].includes(key),
      ),
    );
    // Explicit pin so a registry reorder is a conscious decision, not drift.
    expect(result).toEqual(["data-architect", "ux-design", "software-engineer", "devops-platform"]);
  });

  it("every classifiable key is present in the acumen registry", () => {
    const registryKeys = new Set(ACUMEN_ROOM_SHAPES.map((entry) => entry.professionKey));
    const all = deriveImpactedAcumens([
      "packages/db/prisma/schema.prisma",
      "apps/web/components/x.tsx",
      "apps/web/lib/mcp/x.ts",
      "apps/web/app/api/y/route.ts",
      "scripts/z.sh",
      "apps/web/lib/plain.ts",
    ]);
    expect(all.length).toBe(6);
    for (const key of all) expect(registryKeys.has(key)).toBe(true);
  });
});
