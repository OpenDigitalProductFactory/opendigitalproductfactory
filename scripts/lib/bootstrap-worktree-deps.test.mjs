// scripts/lib/bootstrap-worktree-deps.test.mjs
// Node built-in test runner (no node_modules needed): node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyReadiness,
  readinessReason,
  checkWorkspaceLinksResolveLocally,
  probeWorktreeReadiness,
  missingCompileArtifacts,
  formatReadinessBanner,
  diagnoseUnprovisionedFailure,
  bootstrapWorktreeDeps,
  resolvePinnedPnpmInvocation,
  classifyIgnoredBuilds,
  readAllowBuildsDecisions,
  dependencyPolicyReviewKey,
} from "./bootstrap-worktree-deps.mjs";

test("pnpm 11 delegates to the repository pin instead of overriding it", () => {
  assert.deepEqual(
    resolvePinnedPnpmInvocation("pnpm", "11.19.0", "10.33.2", ["install", "--frozen-lockfile"]),
    { command: "pnpm", args: ["with", "10.33.2", "install", "--frozen-lockfile"], version: "10.33.2", mode: "pinned-shim" },
  );
  assert.deepEqual(
    resolvePinnedPnpmInvocation("pnpm", "10.33.2", "10.33.2", ["ls"]),
    { command: "pnpm", args: ["ls"], version: "10.33.2", mode: "host-match" },
  );
});

test("dependency-policy review identity coalesces exact base/package/reason matches only", () => {
  const base = { baseSha: "abc123", packageName: "sharp", version: "1.2.3", errorCode: "ignored-build" };
  assert.equal(
    dependencyPolicyReviewKey(base),
    "dependency-policy:abc123:sharp@1.2.3:ignored-build",
  );
  assert.notEqual(
    dependencyPolicyReviewKey(base),
    dependencyPolicyReviewKey({ ...base, baseSha: "def456" }),
  );
  assert.notEqual(
    dependencyPolicyReviewKey(base),
    dependencyPolicyReviewKey({ ...base, version: "2.0.0" }),
  );
});

test("ignored-build readiness fails closed when pnpm reports an unclassified script", () => {
  assert.deepEqual(classifyIgnoredBuilds("Automatically ignored builds during installation: None"), {
    ok: true,
    packages: [],
  });
  assert.deepEqual(classifyIgnoredBuilds("Automatically ignored builds during installation:\n  sharp@1.2.3"), {
    ok: false,
    packages: ["sharp@1.2.3"],
  });
});

test("ignored-build parser ignores the Explicitly-ignored section and hint lines (BI @scarf gate)", () => {
  // The real multi-section `pnpm ignored-builds` output once a build is
  // classified into pnpm.ignoredBuiltDependencies. Nothing is unclassified, so
  // the gate must pass — the naive parser used to flag the section header and
  // the package under it, jamming every push from the worktree.
  const classified = [
    "Automatically ignored builds during installation:",
    "  None",
    "",
    "Explicitly ignored package builds (via pnpm.ignoredBuiltDependencies):",
    "  @scarf/scarf",
  ].join("\n");
  assert.deepEqual(classifyIgnoredBuilds(classified), { ok: true, packages: [] });

  // Before classification: the build sits under "Automatically ignored" and pnpm
  // appends advisory "hint:" lines. Flag the package, never the hints.
  const unclassified = [
    "Automatically ignored builds during installation:",
    "  @scarf/scarf",
    "hint: To allow the execution of build scripts, add its name to \"pnpm.onlyBuiltDependencies\".",
    "hint: If you don't want to build a package, add it to the \"pnpm.ignoredBuiltDependencies\" list.",
  ].join("\n");
  assert.deepEqual(classifyIgnoredBuilds(unclassified), { ok: false, packages: ["@scarf/scarf"] });
});

test("compile-ready ONLY when deps resolved AND the cheap gate passes", () => {
  assert.equal(classifyReadiness({ hasNodeModules: true, depProbeOk: true, gateOk: true }), "compile-ready");
  assert.equal(classifyReadiness({ hasNodeModules: true, depProbeOk: true, gateOk: false }), "source-only");
  assert.equal(classifyReadiness({ hasNodeModules: true, depProbeOk: false, gateOk: false }), "source-only");
  assert.equal(classifyReadiness({ hasNodeModules: false, depProbeOk: false, gateOk: false }), "source-only");
});

test("readinessReason explains the source-only cause", () => {
  assert.equal(readinessReason({ hasNodeModules: false, depProbeOk: false, gateOk: false }), "node_modules_missing");
  assert.equal(readinessReason({ hasNodeModules: true, depProbeOk: false, gateOk: false }), "dependency_resolution_failed");
  assert.equal(readinessReason({ hasNodeModules: true, depProbeOk: true, gateOk: false }), "cheap_gate_failed");
  assert.equal(readinessReason({ hasNodeModules: true, depProbeOk: true, gateOk: true }), "managed_bootstrap_ok");
});

test("readinessReason reports workspace_links_stale ahead of the generic cheap-gate reason", () => {
  assert.equal(
    readinessReason({ hasNodeModules: true, depProbeOk: true, gateOk: false, staleWorkspaceLinks: [{ name: "db", target: "/other" }] }),
    "workspace_links_stale",
  );
  assert.equal(
    readinessReason({ hasNodeModules: true, depProbeOk: true, gateOk: true, staleWorkspaceLinks: [] }),
    "managed_bootstrap_ok",
  );
});

test("checkWorkspaceLinksResolveLocally: no @dpf scope -> ok (nothing to check)", () => {
  const result = checkWorkspaceLinksResolveLocally("/wt/topic", { readdir: () => [] });
  assert.deepEqual(result, { ok: true, stale: [] });
});

test("checkWorkspaceLinksResolveLocally: every link resolves inside the worktree -> ok", () => {
  const result = checkWorkspaceLinksResolveLocally("/wt/topic", {
    readdir: () => ["db", "types"],
    realpath: (p) => p.replace("/node_modules/@dpf/", "/packages/"),
  });
  assert.deepEqual(result, { ok: true, stale: [] });
});

test("checkWorkspaceLinksResolveLocally: flags the 2026-07-24 stale-junction class — a link resolving into a SIBLING worktree", () => {
  const result = checkWorkspaceLinksResolveLocally("/wt/wt-73432", {
    readdir: () => ["db", "types"],
    realpath: (p) =>
      p.endsWith("/db")
        ? "/wt/objective-elion-e68a30/packages/db" // stale: a different worktree entirely
        : p.replace("/node_modules/@dpf/", "/packages/"), // types: fine
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.stale, [{ name: "db", target: "/wt/objective-elion-e68a30/packages/db" }]);
});

test("checkWorkspaceLinksResolveLocally: a broken link is not a staleness finding (dependency_resolution_failed covers it)", () => {
  const result = checkWorkspaceLinksResolveLocally("/wt/topic", {
    readdir: () => ["db"],
    realpath: () => null,
  });
  assert.deepEqual(result, { ok: true, stale: [] });
});

test("probeWorktreeReadiness: no node_modules -> source-only / node_modules_missing, never installs", () => {
  const result = probeWorktreeReadiness("/wt/does-not-exist");
  assert.equal(result.status, "source-only");
  assert.equal(result.reason, "node_modules_missing");
  assert.equal(result.checks.hasNodeModules, false);
});

// ── BI-1C1483C6: verification-readiness must be SURFACED, not just computed ──

test("missingCompileArtifacts treats an EMPTY directory as missing", () => {
  // The observed 2026-08-04 shape: apps/web/node_modules EXISTED with 0 entries.
  // existsSync alone would have called that provisioned.
  const present = new Set(["/wt/apps/web/node_modules", "/wt/packages/db/generated"]);
  const missing = missingCompileArtifacts("/wt", {
    exists: (p) => present.has(p),
    readdir: (p) => (p === "/wt/apps/web/node_modules" ? [] : ["client"]),
  });
  const byPath = Object.fromEntries(missing.map((m) => [m.path, m.state]));
  assert.equal(byPath["node_modules"], "absent");
  assert.equal(byPath["apps/web/node_modules"], "empty");
  assert.equal(byPath["packages/db/generated"], undefined, "a populated artifact is not missing");
});

test("missingCompileArtifacts names what each absence FORBIDS", () => {
  const missing = missingCompileArtifacts("/wt", { exists: () => false, readdir: () => [] });
  assert.equal(missing.length, 3);
  assert.ok(missing.every((m) => m.forbids && m.label), "every finding must name a label and a consequence");
  assert.match(
    missing.find((m) => m.path === "apps/web/node_modules").forbids,
    /'next' is not recognized/,
  );
});

test("the banner is silent for a compile-ready worktree", () => {
  assert.deepEqual(formatReadinessBanner({ status: "compile-ready", reason: "managed_bootstrap_ok" }, "/wt"), []);
});

test("the banner names the tree, the gaps, and forbids claiming an unrun gate", () => {
  const lines = formatReadinessBanner(
    {
      status: "source-only",
      reason: "node_modules_missing",
      missing: [{ label: "root node_modules", state: "absent", forbids: "any pnpm script" }],
    },
    "D:/DPF-worktrees/topic",
  );
  assert.match(lines[0], /SOURCE-ONLY/);
  assert.ok(lines.some((l) => l.includes("D:/DPF-worktrees/topic")));
  assert.ok(lines.some((l) => l.includes("root node_modules")));
  assert.ok(lines.some((l) => /do not claim a gate you cannot run/i.test(l)));
  assert.ok(lines.some((l) => /junction/i.test(l)), "the junction foot-gun must travel with the fix instruction");
});

test("an unprovisioned signature is relabelled only when the probe corroborates it", () => {
  const sourceOnly = { status: "source-only", missing: [{ path: "node_modules" }] };
  const hit = diagnoseUnprovisionedFailure("Error: Cannot find package 'react' imported from x", sourceOnly);
  assert.equal(hit.unprovisioned, true);
  assert.match(hit.explanation, /UNPROVISIONED WORKTREE, not a code defect/);
  assert.match(hit.explanation, /never a bare `pnpm install`/);
});

test("the same text in a COMPILE-READY tree stays a real defect", () => {
  const ready = { status: "compile-ready", missing: [] };
  assert.equal(
    diagnoseUnprovisionedFailure("Cannot find package 'react'", ready).unprovisioned,
    false,
    "a broken dependency in a provisioned tree must not be waved through as environmental",
  );
});

test("a signature that does not match what is actually missing is NOT relabelled", () => {
  // Only the Prisma client is missing, but the failure is about react: that is a
  // real dependency problem, not this worktree's provisioning gap.
  const partial = { status: "source-only", missing: [{ path: "packages/db/generated" }] };
  assert.equal(diagnoseUnprovisionedFailure("Cannot find package 'react'", partial).unprovisioned, false);
});

test("the 'next' is not recognized signature maps to apps/web/node_modules", () => {
  const readiness = { status: "source-only", missing: [{ path: "apps/web/node_modules" }] };
  const d = diagnoseUnprovisionedFailure("'next' is not recognized as an internal or external command", readiness);
  assert.equal(d.unprovisioned, true);
  assert.deepEqual(d.matched, ["apps/web/node_modules"]);
});

test("the Prisma client signature maps to packages/db/generated", () => {
  const readiness = { status: "source-only", missing: [{ path: "packages/db/generated" }] };
  const d = diagnoseUnprovisionedFailure("Cannot find module '../generated/client/client'", readiness);
  assert.equal(d.unprovisioned, true);
  assert.deepEqual(d.matched, ["packages/db/generated"]);
});

test("ordinary type errors are never relabelled as environmental", () => {
  const sourceOnly = { status: "source-only", missing: [{ path: "node_modules" }] };
  assert.equal(
    diagnoseUnprovisionedFailure("src/x.ts(4,2): error TS2339: Property 'y' does not exist on type 'Z'.", sourceOnly)
      .unprovisioned,
    false,
  );
});

test("bootstrapWorktreeDeps reports a managed install launch failure instead of silently relabelling it node_modules_missing", () => {
  const result = bootstrapWorktreeDeps("C:/worktrees/topic", {
    exists: () => false,
    pinnedPnpmVersion: "10.33.2",
    execute: (_command, args) => args[0] === "--version" ? {
      ok: true,
      command: "pnpm",
      args,
      status: 0,
      signal: null,
      stdout: "11.19.0\n",
      stderr: "",
    } : ({
      ok: false,
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "pnpm with 10.33.2 install --prefer-offline --frozen-lockfile"],
      error: { name: "Error", code: "EINVAL", message: "spawnSync pnpm.cmd EINVAL" },
      status: null,
      signal: null,
      stdout: "",
      stderr: "",
    }),
  });

  assert.equal(result.status, "source-only");
  assert.equal(result.reason, "managed_install_failed");
  assert.deepEqual(result.failure, {
    phase: "install",
    command: "C:\\Windows\\System32\\cmd.exe",
    args: ["/d", "/s", "/c", "pnpm with 10.33.2 install --prefer-offline --frozen-lockfile"],
    status: null,
    signal: null,
    error: { name: "Error", code: "EINVAL", message: "spawnSync pnpm.cmd EINVAL" },
    stdout: "",
    stderr: "",
  });
});

// ── BI-705AE7E3: a PARTIAL node_modules must not skip the install forever ────
//
// The install used to be gated on `!existsSync(node_modules)`, while this
// module's own header says presence is not enough ("a partial/stale install is
// not ready"). A worktree seeded with a partial tree therefore skipped the
// install permanently: re-running the documented remedy was a no-op and there
// was no force flag. That is not cosmetic — pregate refuses to claim a lease
// for a source-only worktree, so such a tree could never run the mandatory
// build gate, and every push from it needed a recorded override.
//
// Observed 2026-08-26 on a freshly created worktree: 71 entries under
// node_modules, no .pnpm, no .bin, permanently source-only; a healthy sibling
// had 1133 entries and reported compile-ready.

/** Record every command the bootstrapper would run. */
function recordingExecute(calls) {
  return (cmd, args) => {
    calls.push([cmd, ...(args ?? [])].join(" "));
    // Satisfy the pnpm version probe; anything else "succeeds" silently.
    return { ok: true, stdout: "10.33.2", stderr: "", status: 0 };
  };
}

test("a PARTIAL node_modules on disk still triggers the managed install", () => {
  // Uses a REAL directory, because that is the only thing that discriminates:
  // the old guard was `!existsSync(node_modules)` on the real filesystem, so a
  // non-existent path would have installed under both versions. This tree has a
  // node_modules that EXISTS but is partial (no .pnpm, no .bin) — exactly the
  // observed shape. Old behaviour: install skipped, tree stuck source-only
  // forever. New behaviour: readiness is measured, so the install runs.
  const sandbox = mkdtempSync(join(tmpdir(), "dpf-partial-wt-"));
  try {
    mkdirSync(join(sandbox, "node_modules", "some-package"), { recursive: true });
    const calls = [];
    bootstrapWorktreeDeps(sandbox, { execute: recordingExecute(calls) });
    assert.ok(
      calls.some((c) => c.includes("install")),
      `a partial node_modules must not skip the install; commands were: ${JSON.stringify(calls)}`,
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("--force reinstalls even when the probe already reports compile-ready", () => {
  const calls = [];
  // Force short-circuits the readiness check entirely, so the install runs
  // whatever the probe says.
  bootstrapWorktreeDeps("/wt/anything", { force: true, execute: recordingExecute(calls) });
  assert.ok(calls.some((c) => c.includes("install")), "force must always attempt the install");
});

test("the install decision is driven by measured readiness, not by existsSync", () => {
  // The regression asserted at the source: gating on the bare existence of
  // node_modules is what made a partial tree permanently unbootstrappable.
  const source = readFileSync(new URL("./bootstrap-worktree-deps.mjs", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export function bootstrapWorktreeDeps"));
  const offending = body
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
    .filter((line) => /if\s*\(\s*!exists\s*\(/.test(line));
  assert.deepEqual(offending, [], "bootstrapWorktreeDeps must gate its install on probeWorktreeReadiness, not existsSync");
});

test("a build the workspace decided about is classified, wherever pnpm prints it", () => {
  // pnpm only files a package under "Explicitly ignored" when the decision was
  // recorded as pnpm.ignoredBuiltDependencies. This repo records its decisions
  // in pnpm-workspace.yaml `allowBuilds:`, so pnpm still prints those under
  // "Automatically ignored" — and the gate read that as undecided, refusing a
  // worktree that was doing exactly what policy asked (BI-27DECD71).
  const stdout = [
    "Automatically ignored builds during installation:",
    "  puppeteer@25.7.0(yauzl@2.10.0)",
    "  unrs-resolver@1.2.3",
    "hint: To allow the execution of build scripts for a package, add its name to \"pnpm.onlyBuiltDependencies\".",
  ].join("\n");

  const decided = new Set(["puppeteer", "unrs-resolver"]);
  assert.deepEqual(classifyIgnoredBuilds(stdout, decided), { ok: true, packages: [] });
});

test("a build nobody decided about still fails closed, even alongside decided ones", () => {
  const stdout = [
    "Automatically ignored builds during installation:",
    "  puppeteer@25.7.0(yauzl@2.10.0)",
    "  some-new-dep@0.1.0",
  ].join("\n");

  assert.deepEqual(classifyIgnoredBuilds(stdout, new Set(["puppeteer"])), {
    ok: false,
    packages: ["some-new-dep@0.1.0"],
  });
});

test("matching strips the version and peer suffix, and handles scoped names", () => {
  const stdout = [
    "Automatically ignored builds during installation:",
    "  @scope/pkg@2.0.0(peer@1.0.0)",
  ].join("\n");

  assert.deepEqual(classifyIgnoredBuilds(stdout, new Set(["@scope/pkg"])), {
    ok: true,
    packages: [],
  });
});

test("with no decisions supplied the parser behaves exactly as before", () => {
  const stdout = ["Automatically ignored builds during installation:", "  sharp@1.2.3"].join("\n");
  assert.deepEqual(classifyIgnoredBuilds(stdout), { ok: false, packages: ["sharp@1.2.3"] });
});

test("readAllowBuildsDecisions reads every package the workspace decided, true or false", () => {
  const yaml = [
    "minimumReleaseAge: 1440",
    "allowBuilds:",
    "  '@prisma/client': true",
    "  '@scarf/scarf': false",
    "  esbuild: true",
    "  puppeteer: false",
    "packageExtensions:",
    "  '@testing-library/jest-dom':",
    "    peerDependencies:",
    "      vitest: '*'",
  ].join("\n");

  const decided = readAllowBuildsDecisions({ readFile: () => yaml });
  assert.deepEqual(
    [...decided].sort(),
    ["@prisma/client", "@scarf/scarf", "esbuild", "puppeteer"].sort(),
  );
  // The block ends at the next top-level key — nothing from packageExtensions leaks in.
  assert.equal(decided.has("@testing-library/jest-dom"), false);
  assert.equal(decided.has("vitest"), false);
});

test("readAllowBuildsDecisions is fail-safe: an unreadable or absent block decides nothing", () => {
  assert.equal(readAllowBuildsDecisions({ readFile: () => "minimumReleaseAge: 1440" }).size, 0);
  assert.equal(
    readAllowBuildsDecisions({
      readFile: () => {
        throw new Error("ENOENT");
      },
    }).size,
    0,
  );
});
