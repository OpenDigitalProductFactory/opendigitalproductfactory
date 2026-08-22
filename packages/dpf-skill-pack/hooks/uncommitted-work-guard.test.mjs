import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attributeWork,
  buildAttributedWarning,
  buildWarning,
  findDurableArtifactDrift,
  buildUnattributedWarning,
  findLosableWork,
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
// ── BI-910C37B1: scope and attribution ───────────────────────────────────────
//
// 2026-08-21: this guard fired for a plan file and stayed silent about the
// uncommitted SOURCE edits that were actually destroyed. Later the same day it
// reported another session's staged spec as if it belonged to the reader, with
// advice — "commit, stash, or copy" — that would have swept their work away.

describe("BI-910C37B1 — scope and attribution", () => {
  it("findLosableWork sees source edits, not only spec and plan paths", () => {
    const hits = findLosableWork([
      " M apps/web/lib/decision/option-scoring.ts",
      "?? apps/web/lib/decision/new-module.ts",
      " M docs/superpowers/plans/a-plan.md",
    ]);
    assert.equal(hits.length, 3);
    assert.equal(hits.filter((h) => h.durable).length, 1);
  });

  it("findLosableWork ignores regenerated artifacts — nagging about noise trains the reflex that loses work", () => {
    const hits = findLosableWork([
      " M apps/web/lib/docs/doc-index.generated.json",
      " M scripts/prose-lint-baseline.json",
      "?? .DS_Store",
      "?? docs/user-guide/assets/diagrams/architecture/x/0.svg",
      " M apps/web/lib/real-work.ts",
    ]);
    assert.deepEqual(hits.map((h) => h.path), ["apps/web/lib/real-work.ts"]);
  });

  it("attributeWork separates this session's work from another session's", () => {
    const hits = findLosableWork([
      " M apps/web/lib/mine.ts",
      " M docs/superpowers/specs/theirs.md",
    ]);
    const { mine, theirs } = attributeWork(hits, ["apps/web/lib/mine.ts"]);
    assert.deepEqual(mine.map((h) => h.path), ["apps/web/lib/mine.ts"]);
    assert.deepEqual(theirs.map((h) => h.path), ["docs/superpowers/specs/theirs.md"]);
  });

  it("never recommends a mutating recovery for work this session did not author", () => {
    const hits = findLosableWork([" M docs/superpowers/specs/theirs.md"]);
    const warning = buildAttributedWarning(attributeWork(hits, []));
    assert.match(warning, /NOT made by this session/);
    assert.match(warning, /Do not commit or stash it/);
    assert.doesNotMatch(warning, /Commit, stash, or copy it before/);
  });

  it("still tells a session to save its OWN work", () => {
    const hits = findLosableWork([" M apps/web/lib/mine.ts"]);
    const warning = buildAttributedWarning(attributeWork(hits, ["apps/web/lib/mine.ts"]));
    assert.match(warning, /THIS session made/);
    assert.match(warning, /Commit, stash, or copy it/);
  });

  it("says nothing when there is nothing losable", () => {
    assert.equal(buildAttributedWarning({ mine: [], theirs: [] }), "");
  });

});

describe("BI-910C37B1 — the unattributed message", () => {
  it("lists losable work without claiming who made it, and names the shared clone as the fix", () => {
    const warning = buildUnattributedWarning(
      findLosableWork([" M apps/web/lib/a.ts", "?? docs/superpowers/plans/p.md"]),
    );
    assert.match(warning, /apps\/web\/lib\/a\.ts/);
    assert.match(warning, /may belong to another session/);
    assert.match(warning, /take a worktree/);
  });

  it("says nothing when nothing is losable", () => {
    assert.equal(buildUnattributedWarning([]), "");
  });
});
