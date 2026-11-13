import { describe, expect, it, vi } from "vitest";
import { buildRestoreCheckoutCommand, restoreLeakedReadinessCheckout } from "./leaked-readiness-checkout";

const WORKDIR = "/workspace/.builds/FB-533EC6E2";

describe("buildRestoreCheckoutCommand", () => {
  it("only checks out the build branch from a detached, clean clone", () => {
    const command = buildRestoreCheckoutCommand({ workdir: WORKDIR, buildBranch: "build/FB-533EC6E2" });
    expect(command).toContain(`cd '${WORKDIR}'`);
    expect(command).toContain("git symbolic-ref -q HEAD");
    expect(command).toContain("git status --porcelain --untracked-files=no");
    expect(command).toContain("git show-ref --verify -q 'refs/heads/build/FB-533EC6E2'");
    expect(command).toContain("git checkout -q 'build/FB-533EC6E2'");
    // Never a forced checkout, reset or clean: local work is never discarded.
    expect(command).not.toMatch(/checkout -f|--force|reset --hard|git clean/);
  });

  it("refuses an unsafe branch or a workdir outside the sandbox workspace", () => {
    expect(() => buildRestoreCheckoutCommand({ workdir: WORKDIR, buildBranch: "build/x'; rm -rf /" })).toThrow();
    expect(() => buildRestoreCheckoutCommand({ workdir: "/etc", buildBranch: "build/FB-1" })).toThrow();
  });
});

describe("restoreLeakedReadinessCheckout", () => {
  // FB-533EC6E2, 2026-11-13: the published-tree readiness shell was killed (exit
  // 137) after `git checkout --detach ac27ef525`, so its restore never ran and
  // the clone stayed on the published commit.
  it("puts a clone left detached by a killed readiness run back on its build branch", async () => {
    const exec = vi.fn(async () => "DPF_CHECKOUT=restored\n");
    await expect(restoreLeakedReadinessCheckout({ exec, containerId: "c1", workdir: WORKDIR, buildBranch: "build/FB-533EC6E2" }))
      .resolves.toBe("restored");
    expect(exec).toHaveBeenCalledWith("c1", expect.stringContaining("git checkout -q 'build/FB-533EC6E2'"));
  });

  it("reports a clone already on a branch, a dirty clone and an unreadable answer as they are", async () => {
    const run = (out: string) => restoreLeakedReadinessCheckout({
      exec: async () => out, containerId: "c1", workdir: WORKDIR, buildBranch: "build/FB-1",
    });
    await expect(run("DPF_CHECKOUT=on-branch")).resolves.toBe("on-branch");
    await expect(run("DPF_CHECKOUT=dirty")).resolves.toBe("dirty");
    await expect(run("garbage")).resolves.toBe("unknown");
  });

  it("never throws: an exec failure is unknown, and the preflight then refuses as before", async () => {
    await expect(restoreLeakedReadinessCheckout({
      exec: async () => { throw new Error("sandbox gone"); },
      containerId: "c1", workdir: WORKDIR, buildBranch: "build/FB-1",
    })).resolves.toBe("unknown");
  });
});
