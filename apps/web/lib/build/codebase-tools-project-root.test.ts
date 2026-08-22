// Root-sanity guard for the agent codebase tools (BI-6CFC5429).
//
// Regression cover for the 2026-08-19 live failure: PROJECT_ROOT pointed at a
// stale volume missing most of the repo, every search returned `success=true`
// with empty results, and the resulting agent loop was reported to the operator
// as "the local AI wasn't strong enough". The guard cannot fix the root — only
// the operator knows the intended tree — but an empty result must be traceable
// to the root instead of read as "this code does not exist".

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  projectRootLooksValid,
  resetProjectRootWarningForTests,
  warnIfProjectRootSuspect,
} from "./codebase-tools";

const ORIGINAL_ROOT = process.env.PROJECT_ROOT;
const created: string[] = [];

function makeRoot(kind: "valid" | "stale"): string {
  const root = mkdtempSync(join(tmpdir(), `dpf-root-${kind}-`));
  created.push(root);
  if (kind === "valid") {
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    mkdirSync(join(root, "apps", "web"), { recursive: true });
  } else {
    // Mirrors the real failure: a genuine git checkout, just the wrong/old one.
    mkdirSync(join(root, "apps"), { recursive: true });
    writeFileSync(join(root, "package.json"), "{}");
  }
  return root;
}

beforeEach(() => {
  resetProjectRootWarningForTests();
});

afterEach(() => {
  if (ORIGINAL_ROOT === undefined) delete process.env.PROJECT_ROOT;
  else process.env.PROJECT_ROOT = ORIGINAL_ROOT;
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("projectRootLooksValid", () => {
  it("accepts a root carrying the workspace sentinels", () => {
    expect(projectRootLooksValid(makeRoot("valid"))).toBe(true);
  });

  it("rejects a root missing them — the stale-volume shape", () => {
    expect(projectRootLooksValid(makeRoot("stale"))).toBe(false);
  });

  it("rejects a path that does not exist at all", () => {
    expect(projectRootLooksValid(join(tmpdir(), "dpf-root-does-not-exist"))).toBe(false);
  });
});

describe("warnIfProjectRootSuspect", () => {
  it("warns, names the root, and says empty results are not proof of absence", () => {
    const stale = makeRoot("stale");
    process.env.PROJECT_ROOT = stale;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    warnIfProjectRootSuspect();

    expect(warn).toHaveBeenCalledTimes(1);
    const [format, rootArg] = warn.mock.calls[0] as [string, string];
    expect(JSON.parse(rootArg)).toBe(stale);
    expect(format).toContain("not evidence the code is absent");
    expect(format).toContain("BI-6CFC5429");
  });

  it("stays silent on a healthy root", () => {
    process.env.PROJECT_ROOT = makeRoot("valid");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnIfProjectRootSuspect();
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns only once per process so it cannot spam the build log", () => {
    process.env.PROJECT_ROOT = makeRoot("stale");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnIfProjectRootSuspect();
    warnIfProjectRootSuspect();
    warnIfProjectRootSuspect();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
