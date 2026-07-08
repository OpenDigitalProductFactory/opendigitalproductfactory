import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildWarning,
  findDurableArtifactDrift,
  parsePorcelainLine,
} from "./uncommitted-work-scan.mjs";

describe("parsePorcelainLine", () => {
  it("parses modified tracked files", () => {
    assert.deepEqual(parsePorcelainLine(" M docs/superpowers/specs/foo.md"), {
      xy: " M",
      path: "docs/superpowers/specs/foo.md",
    });
  });

  it("parses untracked files", () => {
    assert.deepEqual(parsePorcelainLine("?? docs/superpowers/plans/bar.md"), {
      xy: "??",
      path: "docs/superpowers/plans/bar.md",
    });
  });

  it("parses renames to the destination path", () => {
    assert.deepEqual(
      parsePorcelainLine("R  old.md -> docs/superpowers/specs/new.md"),
      { xy: "R ", path: "docs/superpowers/specs/new.md" },
    );
  });
});

describe("findDurableArtifactDrift", () => {
  it("flags spec and plan paths only", () => {
    const drift = findDurableArtifactDrift([
      " M docs/superpowers/specs/a.md",
      "?? docs/superpowers/plans/b.md",
      " M apps/web/lib/foo.ts",
      "?? README.md",
    ]);
    assert.equal(drift.length, 2);
    assert.ok(drift.some((d) => d.path.endsWith("a.md")));
    assert.ok(drift.some((d) => d.path.endsWith("b.md")));
  });

  it("returns empty when porcelain is clean", () => {
    assert.deepEqual(findDurableArtifactDrift([]), []);
  });
});

describe("buildWarning", () => {
  it("names the escape hatch and lists paths", () => {
    const msg = buildWarning([{ path: "docs/superpowers/specs/x.md", xy: " M" }]);
    assert.match(msg, /uncommitted-work-guard/);
    assert.match(msg, /docs\/superpowers\/specs\/x\.md/);
    assert.match(msg, /DPF_SKIP_UNCOMMITTED_WORK_GUARD/);
  });

  it("uses post-checkout framing when requested", () => {
    const msg = buildWarning([{ path: "docs/superpowers/plans/y.md", xy: "??" }], {
      context: "post-checkout",
    });
    assert.match(msg, /switching branches/);
  });
});