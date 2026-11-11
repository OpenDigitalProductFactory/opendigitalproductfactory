// BI-A78C0965 (live 2026-11-05 → 2026-11-11): a ship or review refresh rebases a
// build onto newer main, which changes its pnpm-lock.yaml, but the build tree's
// install ran only when node_modules/.pnpm was absent. 17 builds kept installs
// from early October under November lockfiles, so the grader's compile-ready gate
// refused every gauntlet (exit 88) and review looped for days.
//
// These run the generated step in a real shell against a stub pnpm, so the
// condition is proven, not string-matched.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSandboxWorktreeAddCommand, buildTreeInstallStep } from "./build-branch";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const OCTOBER = new Date("2026-10-08T00:54:46Z");
const NOVEMBER = new Date("2026-11-05T21:18:55Z");

function buildTree(state: { install: boolean; modulesAt?: Date; lockfileAt: Date }) {
  const root = mkdtempSync(join(tmpdir(), "dpf-build-tree-"));
  dirs.push(root);
  const tree = join(root, "tree");
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  mkdirSync(tree, { recursive: true });
  writeFileSync(join(bin, "pnpm"), `#!/bin/sh\necho "$@" >> ${join(root, "pnpm-calls")}\n`);
  chmodSync(join(bin, "pnpm"), 0o755);
  writeFileSync(join(tree, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  utimesSync(join(tree, "pnpm-lock.yaml"), state.lockfileAt, state.lockfileAt);
  if (state.install) {
    mkdirSync(join(tree, "node_modules/.pnpm"), { recursive: true });
    const modulesAt = state.modulesAt ?? state.lockfileAt;
    writeFileSync(join(tree, "node_modules/.modules.yaml"), "layoutVersion: 5\n");
    utimesSync(join(tree, "node_modules/.modules.yaml"), modulesAt, modulesAt);
  }
  const run = (command: string) => execFileSync("sh", ["-c", command], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: "utf8",
  });
  const installs = () => existsSync(join(root, "pnpm-calls")) ? readFileSync(join(root, "pnpm-calls"), "utf8") : "";
  return { tree, run, installs };
}

describe("buildTreeInstallStep", () => {
  it("reinstalls a tree whose lockfile is newer than its install", () => {
    const t = buildTree({ install: true, modulesAt: OCTOBER, lockfileAt: NOVEMBER });
    t.run(buildTreeInstallStep("FB-2F2D46D5", t.tree));
    expect(t.installs()).toContain("install --offline --frozen-lockfile");
    // a successful install marks the tree current, so the next ensure does not repeat it
    t.run(buildTreeInstallStep("FB-2F2D46D5", t.tree));
    expect(t.installs().trim().split("\n")).toHaveLength(1);
  });

  it("keeps a current install and installs a tree that has none", () => {
    const current = buildTree({ install: true, modulesAt: NOVEMBER, lockfileAt: OCTOBER });
    current.run(buildTreeInstallStep("FB-1", current.tree));
    expect(current.installs()).toBe("");
    const bare = buildTree({ install: false, lockfileAt: NOVEMBER });
    bare.run(buildTreeInstallStep("FB-1", bare.tree));
    expect(bare.installs()).toContain("install --offline --frozen-lockfile");
  });

  it("is the step the reused worktree re-asserts on every ensure", () => {
    const cmd = buildSandboxWorktreeAddCommand("FB-ABCD1234", "build/FB-ABCD1234");
    const reuseBranch = cmd.slice(cmd.indexOf("; then "), cmd.indexOf("; else "));
    expect(reuseBranch).toContain(buildTreeInstallStep("FB-ABCD1234", "/workspace/.builds/FB-ABCD1234"));
  });
});
