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

// ── Stop hook re-entry ───────────────────────────────────────────────────────
//
// 2026-09-23: with one dirty file in a clone, every Stop re-fired the guard,
// the guard re-emitted its context, the model answered, and the turn tried to
// end again — nine times, until Claude Code's block cap overrode the hook.
// The harness marks the re-entry pass with `stop_hook_active`; the guard must
// return success silently there.

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function dirtyRepo() {
  const dir = mkdtempSync(join(tmpdir(), "uwg-"));
  const git = (...a) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeFileSync(join(dir, "a.txt"), "1\n");
  git("add", "a.txt");
  git("commit", "-q", "-m", "init");
  writeFileSync(join(dir, "a.txt"), "2\n");
  return dir;
}

function runGuard(dir, payload, ...extra) {
  const script = fileURLToPath(new URL("./uncommitted-work-guard.mjs", import.meta.url));
  return spawnSync(process.execPath, [script, "--repo-root", dir, ...extra], {
    encoding: "utf8",
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PROJECT_DIR: "", DPF_SKIP_UNCOMMITTED_WORK_GUARD: "" },
  });
}

describe("Stop hook re-entry (stop_hook_active)", () => {
  it("warns on the first Stop when the tree is dirty", () => {
    const r = runGuard(dirtyRepo(), { hook_event_name: "Stop", stop_hook_active: false });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /uncommitted-work-guard/);
    assert.match(r.stdout, /a\.txt/);
  });

  it("stays silent on the re-entry pass so the turn can end", () => {
    const r = runGuard(dirtyRepo(), { hook_event_name: "Stop", stop_hook_active: true });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });
});

// ── Session baseline and once-per-set ────────────────────────────────────────
//
// 2026-09-23, after #5568: `.mcp.json` was dirty in the shared clone before a
// session started. The session never touched it — it worked and pushed from
// its own worktree — yet the guard warned at the end of every turn, 50+ times.
// `stop_hook_active` resets each turn, so it could not stop that. The guard
// now snapshots dirty paths at SessionStart and says each distinct set once.

import { appendFileSync } from "node:fs";
import { subtractBaseline, warnedSetSignature } from "./uncommitted-work-scan.mjs";

const stop = (session_id) => ({ hook_event_name: "Stop", stop_hook_active: false, session_id });

describe("session baseline: pre-existing dirt the session never touched", () => {
  it("never prompts, on any turn, for a file dirty before the session started", () => {
    const dir = dirtyRepo();
    assert.equal(runGuard(dir, { hook_event_name: "SessionStart", session_id: "s1" }, "--snapshot").status, 0);
    for (let turn = 0; turn < 3; turn++) {
      const r = runGuard(dir, stop("s1"));
      assert.equal(r.status, 0);
      assert.equal(r.stdout, "", `turn ${turn} must stay silent`);
    }
  });

  it("does report a file the session dirtied after the snapshot", () => {
    const dir = dirtyRepo();
    runGuard(dir, { session_id: "s2" }, "--snapshot");
    writeFileSync(join(dir, "new.txt"), "mine\n");
    const r = runGuard(dir, stop("s2"));
    assert.match(r.stdout, /new\.txt/);
    assert.doesNotMatch(r.stdout, /a\.txt/);
  });

  it("does report a pre-existing dirty file once the session edits it further", () => {
    const dir = dirtyRepo();
    runGuard(dir, { session_id: "s3" }, "--snapshot");
    appendFileSync(join(dir, "a.txt"), "more from this session\n");
    assert.match(runGuard(dir, stop("s3")).stdout, /a\.txt/);
  });

  it("keeps baselines per session: a new session in the same clone is not silenced by another's", () => {
    const dir = dirtyRepo();
    runGuard(dir, { session_id: "early" }, "--snapshot");
    writeFileSync(join(dir, "later.txt"), "x\n");
    runGuard(dir, { session_id: "late" }, "--snapshot");
    assert.equal(runGuard(dir, stop("late")).stdout, "");
    assert.match(runGuard(dir, stop("early")).stdout, /later\.txt/);
  });
});

describe("once per distinct set, per session", () => {
  it("warns on the first turn, not on later turns with the same set", () => {
    const dir = dirtyRepo(); // no snapshot: session predates the SessionStart wiring
    assert.match(runGuard(dir, stop("t1")).stdout, /a\.txt/);
    assert.equal(runGuard(dir, stop("t1")).stdout, "");
    assert.equal(runGuard(dir, stop("t1")).stdout, "");
  });

  it("warns again when the set changes", () => {
    const dir = dirtyRepo();
    runGuard(dir, stop("t2"));
    writeFileSync(join(dir, "b.txt"), "b\n");
    const r = runGuard(dir, stop("t2"));
    assert.match(r.stdout, /b\.txt/);
  });

  it("without a session id, behaves as before and warns", () => {
    const dir = dirtyRepo();
    assert.match(runGuard(dir, { hook_event_name: "Stop" }).stdout, /a\.txt/);
    assert.match(runGuard(dir, { hook_event_name: "Stop" }).stdout, /a\.txt/);
  });

  it("keeps its state out of the working tree", () => {
    const dir = dirtyRepo();
    runGuard(dir, { session_id: "t3" }, "--snapshot");
    runGuard(dir, stop("t3"));
    const status = spawnSync("git", ["-C", dir, "status", "--porcelain"], { encoding: "utf8" }).stdout;
    assert.equal(status.trim(), "M a.txt");
  });
});

// ── 2026-09-25: desktop Code tab, 7+ warnings in one session ─────────────────
//
// In the shared root clone the only dirty file was a `.mcp.json` the bootstrap
// wrote, and the guard re-prompted on every Stop. That host does not mark a
// re-entry pass with `stop_hook_active`, so the once-per-set memory is the only
// thing between it and a loop — and it must not be reset by a rewrite that
// leaves the dirty set unchanged.

describe("once per session, without stop_hook_active", () => {
  const plainStop = (session_id) => ({ hook_event_name: "Stop", session_id });

  it("says nothing the second time for the same session and dirty set", () => {
    const dir = dirtyRepo();
    const first = runGuard(dir, plainStop("desk-1"));
    assert.equal(first.status, 0);
    assert.match(first.stdout, /a\.txt/);
    const second = runGuard(dir, plainStop("desk-1"));
    assert.equal(second.status, 0);
    assert.equal(second.stdout, "");
  });

  it("stays silent when a file in the set is rewritten in place", () => {
    const dir = dirtyRepo();
    runGuard(dir, plainStop("desk-2"));
    writeFileSync(join(dir, "a.txt"), "rewritten by a generator, longer than before\n");
    assert.equal(runGuard(dir, plainStop("desk-2")).stdout, "");
  });

  it("warns again when the dirty set changes", () => {
    const dir = dirtyRepo();
    runGuard(dir, plainStop("desk-3"));
    writeFileSync(join(dir, "c.txt"), "c\n");
    const r = runGuard(dir, plainStop("desk-3"));
    assert.match(r.stdout, /c\.txt/);
  });

  it("does not let one session's warning silence another's", () => {
    const dir = dirtyRepo();
    runGuard(dir, plainStop("desk-4"));
    assert.match(runGuard(dir, plainStop("desk-5")).stdout, /a\.txt/);
  });
});

describe("SessionEnd output shape", () => {
  it("emits a systemMessage, not hookSpecificOutput.additionalContext", () => {
    const r = runGuard(dirtyRepo(), { hook_event_name: "SessionEnd", session_id: "end-1" });
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.hookSpecificOutput, undefined);
    assert.match(out.systemMessage, /uncommitted-work-guard/);
    assert.match(out.systemMessage, /a\.txt/);
  });

  it("keeps additionalContext for Stop", () => {
    const r = runGuard(dirtyRepo(), { hook_event_name: "Stop", session_id: "end-2" });
    const out = JSON.parse(r.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, "Stop");
    assert.match(out.hookSpecificOutput.additionalContext, /a\.txt/);
  });
});

describe("subtractBaseline / warnedSetSignature", () => {
  const hits = [
    { path: "a", xy: " M", fingerprint: "f1" },
    { path: "b", xy: "??", fingerprint: "f2" },
  ];
  it("drops only paths whose fingerprint is unchanged", () => {
    assert.deepEqual(subtractBaseline(hits, { a: "f1", b: "old" }).map((h) => h.path), ["b"]);
  });
  it("passes everything through with no baseline", () => {
    assert.equal(subtractBaseline(hits, null).length, 2);
  });
  it("is order-independent", () => {
    assert.equal(warnedSetSignature(hits), warnedSetSignature([...hits].reverse()));
  });
  it("ignores fingerprints but not status", () => {
    const rewritten = hits.map((h) => ({ ...h, fingerprint: "changed" }));
    assert.equal(warnedSetSignature(hits), warnedSetSignature(rewritten));
    const deleted = [{ ...hits[0], xy: " D" }, hits[1]];
    assert.notEqual(warnedSetSignature(hits), warnedSetSignature(deleted));
  });
});

// ── One live copy per event (BI-F4BE47B5) ────────────────────────────────────
//
// 2026-09-23/24, after #5568 and #5592: Claude Code ran the guard twice per
// Stop, once from the checkout (.claude/settings.json) and once from the
// dpf-platform plugin cache. That cache is shared by every checkout and holds
// whatever tree last ran `claude plugin install`, which was a tree from before
// both fixes. So it warned on every Stop and every re-entry. The checkout's copy
// is the one that matches the checkout, so the plugin copy stands down when the
// project registers its own.

import { copyFileSync, mkdirSync } from "node:fs";

const HOOKS_DIR = fileURLToPath(new URL(".", import.meta.url));

function projectWithOwnGuard(dir, { registered = true } = {}) {
  const hooks = join(dir, "packages", "dpf-skill-pack", "hooks");
  mkdirSync(hooks, { recursive: true });
  for (const f of ["uncommitted-work-guard.mjs", "uncommitted-work-scan.mjs", "durable-artifact-paths.mjs"]) {
    copyFileSync(join(HOOKS_DIR, f), join(hooks, f));
  }
  mkdirSync(join(dir, ".claude"), { recursive: true });
  const command = registered
    ? 'node "${CLAUDE_PROJECT_DIR}/packages/dpf-skill-pack/hooks/uncommitted-work-guard.mjs"'
    : 'node "${CLAUDE_PROJECT_DIR}/scripts/something-else.mjs"';
  writeFileSync(
    join(dir, ".claude", "settings.json"),
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command }] }] } }),
  );
  return join(hooks, "uncommitted-work-guard.mjs");
}

function runAs(script, dir, payload, projectDir, ...extra) {
  return spawnSync(process.execPath, [script, "--repo-root", dir, ...extra], {
    encoding: "utf8",
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, DPF_SKIP_UNCOMMITTED_WORK_GUARD: "" },
  });
}

const PLUGIN_COPY = fileURLToPath(new URL("./uncommitted-work-guard.mjs", import.meta.url));

describe("one live copy per event: the plugin copy stands down for the checkout's", () => {
  it("the plugin copy is silent on Stop when the project registers its own guard", () => {
    const dir = dirtyRepo();
    projectWithOwnGuard(dir);
    const r = runAs(PLUGIN_COPY, dir, stop("p1"), dir);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });

  it("the plugin copy writes no snapshot either, so it cannot claim the warning first", () => {
    const dir = dirtyRepo();
    const own = projectWithOwnGuard(dir);
    runAs(PLUGIN_COPY, dir, { session_id: "p2" }, dir, "--snapshot");
    runAs(PLUGIN_COPY, dir, stop("p2"), dir);
    // The project copy has no baseline for p2 and has not warned yet: it warns once.
    assert.match(runAs(own, dir, stop("p2"), dir).stdout, /a\.txt/);
    assert.equal(runAs(own, dir, stop("p2"), dir).stdout, "");
  });

  it("the project's own copy still warns, once per set", () => {
    const dir = dirtyRepo();
    const own = projectWithOwnGuard(dir);
    assert.match(runAs(own, dir, stop("p3"), dir).stdout, /a\.txt/);
    assert.equal(runAs(own, dir, stop("p3"), dir).stdout, "");
  });

  it("the plugin copy still runs when the project does not register the guard", () => {
    const dir = dirtyRepo();
    projectWithOwnGuard(dir, { registered: false });
    assert.match(runAs(PLUGIN_COPY, dir, stop("p4"), dir).stdout, /uncommitted-work-guard/);
  });

  it("the plugin copy still runs with no Claude project (Codex, Grok)", () => {
    const dir = dirtyRepo();
    projectWithOwnGuard(dir);
    assert.match(runAs(PLUGIN_COPY, dir, stop("p5"), "").stdout, /uncommitted-work-guard/);
  });
});

// ── No state in the shared temp dir ──────────────────────────────────────────
//
// CodeQL js/insecure-temporary-file (alerts #412, #413): when git could not name
// its common dir, the guard kept session state under a predictable path in the
// OS temp dir, which any local user can pre-create to read the baseline or
// suppress warnings. Outside a git repo there is no work to lose, so the guard
// must keep no state there at all.

import { existsSync, readdirSync } from "node:fs";

describe("state location", () => {
  it("writes nothing to the OS temp dir when the folder is not a git repo", () => {
    const privateTmp = mkdtempSync(join(tmpdir(), "uwg-tmp-"));
    const notARepo = mkdtempSync(join(privateTmp, "plain-"));
    const script = fileURLToPath(new URL("./uncommitted-work-guard.mjs", import.meta.url));
    const env = {
      ...process.env,
      TMPDIR: privateTmp,
      TMP: privateTmp,
      TEMP: privateTmp,
      GIT_CEILING_DIRECTORIES: privateTmp,
      CLAUDE_PROJECT_DIR: "",
      DPF_SKIP_UNCOMMITTED_WORK_GUARD: "",
    };
    for (const [payload, extra] of [
      [{ hook_event_name: "SessionStart", session_id: "t1" }, ["--snapshot"]],
      [stop("t1"), []],
    ]) {
      const r = spawnSync(process.execPath, [script, "--repo-root", notARepo, ...extra], {
        encoding: "utf8",
        input: JSON.stringify(payload),
        env,
      });
      assert.equal(r.status, 0);
    }
    assert.equal(existsSync(join(privateTmp, "dpf-hook-state")), false);
    assert.deepEqual(readdirSync(privateTmp).filter((n) => !n.startsWith("plain-")), []);
  });
});
