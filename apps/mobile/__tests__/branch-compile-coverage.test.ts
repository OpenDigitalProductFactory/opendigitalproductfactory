// Guards the mobile-compiler-coverage-gap risk: the local-ci typecheck gate
// runs `pnpm --filter web typecheck:all`, which excludes apps/mobile. Without
// this test, the mobile files this branch changed are compiled only by the
// device build (long after merge). Scope is the branch's diff, so the guard
// moves with the change and is isolated from unrelated pre-existing mobile
// errors elsewhere in the package.
import * as path from "node:path";
import * as fs from "node:fs";
import * as ts from "typescript";

const ROOT = path.resolve(__dirname, "..");

// Files this branch changes under apps/mobile/. Update when adding new files.
const CHANGED_FILES = [
  "app/(tabs)/nearby/[slug].tsx",
  "src/features/visitor/cart.ts",
  "src/features/visitor/cart.test.ts",
  "src/features/visitor/visitor.store.ts",
  "src/features/visitor/visitor.store.test.ts",
  "__tests__/nearby-menu-screen.test.tsx",
  "__tests__/branch-compile-coverage.test.ts",
].map((rel) => path.join(ROOT, rel));

function formatAll(diagnostics: readonly ts.Diagnostic[]): string {
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => ROOT,
    getNewLine: () => "\n",
  });
}

describe("mobile branch-scoped compile coverage", () => {
  jest.setTimeout(60_000);

  it("every changed mobile file exists at the committed path", () => {
    for (const f of CHANGED_FILES) {
      expect({ file: f, exists: fs.existsSync(f) }).toEqual({ file: f, exists: true });
    }
  });

  it("every changed mobile file compiles with no TypeScript diagnostics", () => {
    const configPath = path.join(ROOT, "tsconfig.json");
    const configRead = ts.readConfigFile(configPath, ts.sys.readFile);
    expect(configRead.error).toBeUndefined();

    const parsed = ts.parseJsonConfigFileContent(
      configRead.config,
      ts.sys,
      ROOT,
      undefined,
      configPath,
    );
    expect(parsed.errors).toEqual([]);

    const program = ts.createProgram({
      rootNames: CHANGED_FILES,
      options: { ...parsed.options, noEmit: true },
    });

    const all = ts.getPreEmitDiagnostics(program);
    const scopedPaths = new Set(CHANGED_FILES.map((p) => path.resolve(p)));
    const scoped = all.filter(
      (d) => d.file != null && scopedPaths.has(path.resolve(d.file.fileName)),
    );

    if (scoped.length > 0) {
      throw new Error(
        `mobile compile coverage found ${scoped.length} diagnostic(s) in branch-changed files:\n`
          + formatAll(scoped),
      );
    }
    expect(scoped).toEqual([]);
  });
});
