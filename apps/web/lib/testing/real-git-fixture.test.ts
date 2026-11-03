import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createRealGitFixture, type RealGitFixture } from "./real-git-fixture";

const prefix = "dpf-bounded-git-test-";
const stopped = (pid: number) => expect(() => process.kill(pid, 0)).toThrow();

describe("real Git fixture lifecycle", () => {
  it("cleans its owned partial root when setup fails before assignment", async () => {
    let allocated = "";
    await expect(createRealGitFixture(prefix, async (fixture) => {
      allocated = fixture.root;
      await fixture.git("init", "-q");
      await fixture.git("rev-parse", "--verify", "refs/heads/absent");
    })).rejects.toThrow(/git rev-parse.*refs\/heads\/absent/);
    expect(allocated).not.toBe("");
    await expect(access(allocated)).rejects.toMatchObject({ code: "ENOENT" });
  });

  for (const [name, commandMs, setupMs] of [["command", 300, 5_000], ["overall setup", 5_000, 300]] as const) {
    it(`enforces the ${name} deadline and closes the actual subprocess before cleaning`, async () => {
      let allocated = "";
      let pid: number | undefined;
      const attempt = createRealGitFixture(prefix, async (fixture) => {
        allocated = fixture.root;
        try { await fixture.command("blocked subprocess", process.execPath, ["-e", "setInterval(() => {}, 1000)"]); }
        catch (error) { pid = (error as { childPid?: number }).childPid; throw error; }
      }, { commandMs, setupMs });
      await expect(attempt).rejects.toThrow(/blocked subprocess.*(bound 300ms|setup deadline 300ms)/);
      expect(pid).toBeTypeOf("number");
      stopped(pid!);
      await expect(access(allocated)).rejects.toMatchObject({ code: "ENOENT" });
    });
  }

  it("rejects later commands from setup that resumes after its deadline", async () => {
    let resume!: () => void;
    let late!: Promise<unknown>;
    const blocked = new Promise<void>((resolve) => { resume = resolve; });
    await expect(createRealGitFixture(prefix, async (fixture) => {
      await blocked;
      late = fixture.git("init", "-q").catch((error: unknown) => error);
      await late;
    }, { setupMs: 30 })).rejects.toThrow(/setup deadline/);
    resume();
    await Promise.resolve();
    expect(await late).toBeInstanceOf(Error);
    expect(String(await late)).toContain("fixture closed");
  });

  it("does not admit a successful setup with an unawaited subprocess", async () => {
    let result: (RealGitFixture & { value: void }) | undefined;
    try {
      await expect((async () => {
        result = await createRealGitFixture(prefix, async (fixture) => {
          void fixture.command("unawaited subprocess", process.execPath, ["-e", "setInterval(() => {}, 1000)"]).catch(() => {});
        });
      })()).rejects.toThrow(/unawaited/);
    } finally { await result?.dispose(); }
  });

  it("retains actual commits, ignores inherited hooks and disposes only its own root", async () => {
    const neighbor = await mkdtemp(path.join(tmpdir(), "dpf-git-neighbor-"));
    const sentinel = path.join(neighbor, "keep.txt");
    await writeFile(sentinel, "keep");
    let fixture: RealGitFixture | undefined;
    try {
      fixture = await createRealGitFixture(prefix, async (repo) => {
        await repo.git("init", "-q", "--initial-branch=main");
        await repo.git("config", "user.name", "Test");
        await repo.git("config", "user.email", "test@example.invalid");
        await writeFile(path.join(repo.root, ".git", "hooks", "pre-commit"), "#!/bin/sh\nexit 42\n", { mode: 0o755 });
        await writeFile(path.join(repo.root, "a.txt"), "one\n");
        await repo.git("add", ".");
        await repo.git("commit", "-q", "-m", "actual commit");
      });
      expect((await fixture.git("log", "-1", "--format=%s")).stdout.trim()).toBe("actual commit");
      await fixture.dispose();
      await fixture.dispose();
      await expect(access(fixture.root)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(sentinel, "utf8")).toBe("keep");
    } finally {
      await fixture?.dispose();
      // neighbor is the exact root this test allocated; no computed traversal.
      await rm(neighbor, { recursive: true, force: true });
    }
  });

  it("does not inherit a Git directory that redirects writes outside its root", async () => {
    const foreign = await createRealGitFixture(prefix, async (repo) => { await repo.git("init", "-q"); });
    const previous = process.env.GIT_DIR;
    let own: RealGitFixture | undefined;
    try {
      process.env.GIT_DIR = path.join(foreign.root, ".git");
      own = await createRealGitFixture(prefix, async (repo) => { await repo.git("init", "-q"); });
      await expect(access(path.join(own.root, ".git", "HEAD"))).resolves.toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = previous;
      await Promise.all([own?.dispose(), foreign.dispose()]);
    }
  });

  it("refuses path traversal and non-finite budgets before allocation", async () => {
    await expect(createRealGitFixture("../unsafe-", async () => {})).rejects.toThrow(/prefix/);
    for (const commandMs of [0, -1, Infinity, NaN, 0.5]) {
      await expect(createRealGitFixture(prefix, async () => {}, { commandMs })).rejects.toThrow(/finite/);
    }
  });
});
