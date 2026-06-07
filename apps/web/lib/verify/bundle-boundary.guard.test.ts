import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOST_ONLY_MATCHERS,
  extractStaticImports,
  findBoundaryViolations,
  isHostOnlyModule,
  type EntrypointImports,
} from "./bundle-boundary";

describe("extractStaticImports", () => {
  it("includes static default, named, namespace, and bare imports", () => {
    const src = `
      import a from "mod-a";
      import { b } from "mod-b";
      import * as c from "mod-c";
      import "mod-d";
    `;
    const specs = extractStaticImports(src);
    expect(specs).toEqual(expect.arrayContaining(["mod-a", "mod-b", "mod-c", "mod-d"]));
  });

  it("includes re-exports (barrels)", () => {
    expect(extractStaticImports(`export * from "./promoter";`)).toContain("./promoter");
    expect(extractStaticImports(`export { runPromoter } from "./promoter";`)).toContain("./promoter");
  });

  it("EXCLUDES dynamic import() — the sanctioned lazy boundary", () => {
    const src = `const p = await import("@/lib/self-upgrade/promoter");`;
    expect(extractStaticImports(src)).not.toContain("@/lib/self-upgrade/promoter");
  });

  it("EXCLUDES import type / export type — erased at build", () => {
    const src = `
      import type { Foo } from "@/lib/self-upgrade/promoter";
      export type { Bar } from "dockerode";
    `;
    expect(extractStaticImports(src)).toHaveLength(0);
  });

  it("includes a value import even with an inline type member", () => {
    expect(extractStaticImports(`import { type A, b } from "mod-x";`)).toContain("mod-x");
  });
});

describe("isHostOnlyModule", () => {
  it("matches the promoter module and dockerode in any path form", () => {
    expect(isHostOnlyModule("@/lib/self-upgrade/promoter")).toBe(true);
    expect(isHostOnlyModule("../self-upgrade/promoter.ts")).toBe(true);
    expect(isHostOnlyModule("dockerode")).toBe(true);
  });
  it("does not match pure siblings or the classifier", () => {
    expect(isHostOnlyModule("@/lib/self-upgrade/build-failure-classifier")).toBe(false);
    expect(isHostOnlyModule("@/lib/self-upgrade/config")).toBe(false);
  });
});

describe("findBoundaryViolations", () => {
  const entries: EntrypointImports[] = [
    { path: "api/inngest/route.ts", imports: ["@/lib/self-upgrade/promoter", "react"] },
    { path: "api/ok/route.ts", imports: ["@/lib/self-upgrade/config", "@/lib/self-upgrade"] },
  ];

  it("flags a direct host-only import", () => {
    const v = findBoundaryViolations(entries);
    expect(v).toContainEqual({
      entrypoint: "api/inngest/route.ts",
      specifier: "@/lib/self-upgrade/promoter",
      via: "direct",
    });
  });

  it("flags a barrel that re-exports a host-only module when its specifier is in the set", () => {
    const v = findBoundaryViolations(entries, new Set(["@/lib/self-upgrade"]));
    expect(v).toContainEqual({
      entrypoint: "api/ok/route.ts",
      specifier: "@/lib/self-upgrade",
      via: "barrel",
    });
  });

  it("passes a clean entrypoint set", () => {
    const clean: EntrypointImports[] = [
      { path: "api/x/route.ts", imports: ["@/lib/self-upgrade/config", "next/server"] },
    ];
    expect(findBoundaryViolations(clean)).toHaveLength(0);
  });
});

// --- Real-tree regression guard: locks in the §2.1 fix and PR #1555 ---------
const WEB_ROOT = join(__dirname, "..", "..");

function collect(dir: string, match: (p: string) => boolean): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir, { recursive: true }) as string[];
  } catch {
    return [];
  }
  return entries
    .map((e) => join(dir, e))
    .filter((p) => match(p) && !p.endsWith(".test.ts") && !p.endsWith(".test.tsx"));
}

describe("server entrypoints do not statically import host-only modules (real tree)", () => {
  it("no route.ts or Inngest function pulls the promoter/dockerode graph into the bundle", () => {
    const routeFiles = collect(join(WEB_ROOT, "app", "api"), (p) => p.endsWith("route.ts"));
    const inngestFiles = collect(join(WEB_ROOT, "lib", "queue", "functions"), (p) =>
      p.endsWith(".ts"),
    );
    const files = [...routeFiles, ...inngestFiles];
    // Sanity: the globs actually matched something (guards against a silently
    // empty pass if the tree layout changes).
    expect(files.length).toBeGreaterThan(0);

    const entrypoints: EntrypointImports[] = files.map((path) => ({
      path: path.slice(WEB_ROOT.length + 1).replace(/\\/g, "/"),
      imports: extractStaticImports(readFileSync(path, "utf-8")),
    }));

    const violations = findBoundaryViolations(entrypoints, new Set(), DEFAULT_HOST_ONLY_MATCHERS);
    expect(
      violations,
      `Host-only modules statically imported into the server bundle (use a dynamic import() boundary — see PR #1555):\n${violations
        .map((v) => `  ${v.entrypoint} -> ${v.specifier} (${v.via})`)
        .join("\n")}`,
    ).toEqual([]);
  });
});
