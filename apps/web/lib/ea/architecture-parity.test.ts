import { describe, expect, it } from "vitest";
import {
  extractDeterministicSourceKeys,
  parseSourceKey,
  auditSourceKeys,
  type FileResolver,
} from "./architecture-parity";

describe("extractDeterministicSourceKeys", () => {
  it("extracts det() first-arg sourceKeys and ignores arch()", () => {
    const src = `
      properties: det("packages/db/prisma/schema.prisma#Agent"),
      properties: det("apps/web/lib/tak/agent-grants.ts", { extra: 1 }),
      properties: arch({ sourceKey: "packages/db/prisma/schema.prisma#AuthorizationDecisionLog" }),
    `;
    const keys = extractDeterministicSourceKeys(src);
    expect(keys).toEqual([
      "packages/db/prisma/schema.prisma#Agent",
      "apps/web/lib/tak/agent-grants.ts",
    ]);
    // arch() reference is exempt (architect-judgment / aspirational).
    expect(keys).not.toContain("packages/db/prisma/schema.prisma#AuthorizationDecisionLog");
  });
});

describe("parseSourceKey", () => {
  it("splits multi-path keys on ';' and parses path#symbol", () => {
    const refs = parseSourceKey("apps/web/lib/a.ts#Foo; packages/db/prisma/schema.prisma#Bar");
    expect(refs).toEqual([
      { path: "apps/web/lib/a.ts", symbol: "Foo", raw: "apps/web/lib/a.ts#Foo" },
      { path: "packages/db/prisma/schema.prisma", symbol: "Bar", raw: "packages/db/prisma/schema.prisma#Bar" },
    ]);
  });

  it("keeps a path with no symbol, and a line-range suffix as the symbol", () => {
    expect(parseSourceKey("apps/web/lib/a.ts")).toEqual([{ path: "apps/web/lib/a.ts", symbol: null, raw: "apps/web/lib/a.ts" }]);
    expect(parseSourceKey("apps/web/lib/a.ts#L12-20")[0]).toMatchObject({ path: "apps/web/lib/a.ts", symbol: "L12-20" });
  });

  it("skips purely descriptive segments with no path token", () => {
    expect(parseSourceKey("RouteDecisionLog + RouteOutcome (view unbuilt)")).toEqual([]);
  });
});

describe("auditSourceKeys", () => {
  const resolver = (files: Record<string, string>): FileResolver => (p) => files[p] ?? null;

  it("flags a missing path as PARITY-001 error", () => {
    const findings = auditSourceKeys(["apps/web/lib/gone.ts#Foo"], resolver({}));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ invariantId: "PARITY-001", severity: "error", file: "apps/web/lib/gone.ts" });
  });

  it("passes when the path exists and the clean symbol is present", () => {
    const findings = auditSourceKeys(
      ["apps/web/lib/a.ts#Agent"],
      resolver({ "apps/web/lib/a.ts": "export model Agent {}" })
    );
    expect(findings).toHaveLength(0);
  });

  it("flags a missing clean symbol as PARITY-002 warn", () => {
    const findings = auditSourceKeys(
      ["apps/web/lib/a.ts#Renamed"],
      resolver({ "apps/web/lib/a.ts": "export const somethingElse = 1" })
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ invariantId: "PARITY-002", severity: "warn" });
  });

  it("does a path-only check for line refs (range and single line) — no false symbol warning", () => {
    for (const key of ["apps/web/lib/a.ts#L10-20", "apps/web/lib/a.ts#L210"]) {
      const findings = auditSourceKeys([key], resolver({ "apps/web/lib/a.ts": "anything" }));
      expect(findings, key).toHaveLength(0);
    }
  });

  it("checks every path in a multi-path key", () => {
    const findings = auditSourceKeys(
      ["apps/web/lib/a.ts; apps/web/lib/gone.ts"],
      resolver({ "apps/web/lib/a.ts": "ok" })
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe("apps/web/lib/gone.ts");
  });
});
