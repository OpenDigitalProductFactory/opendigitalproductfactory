/**
 * BI-0DF1F354 — unit tests for the pure preflight (node:test, no vitest).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assessDevPortalWorkspace,
  formatPreflightFailure,
  preflightExitCode,
} from "./dev-portal-workspace-preflight.mjs";

function ioFromMap(map) {
  return {
    existsSync: (p) => map.has(p),
    statSync: (p) => {
      if (!map.has(p) && ![...map.keys()].some((k) => k.startsWith(p + "/") || k === p)) {
        // allow root dir if any child exists under it
        const hasChild = [...map.keys()].some((k) => k.startsWith(String(p).replace(/\/$/, "") + "/"));
        if (!hasChild && !map.has(p)) {
          const err = new Error("ENOENT");
          /** @type {NodeJS.ErrnoException} */
          (err).code = "ENOENT";
          throw err;
        }
      }
      return {
        isDirectory: () => {
          if (map.get(p)?.type === "file") return false;
          return true;
        },
      };
    },
    readFileSync: (p) => {
      const entry = map.get(p);
      if (!entry || entry.type !== "file") {
        const err = new Error("ENOENT");
        /** @type {NodeJS.ErrnoException} */
        (err).code = "ENOENT";
        throw err;
      }
      return entry.body;
    },
  };
}

describe("assessDevPortalWorkspace (BI-0DF1F354)", () => {
  it("fails when root is empty", () => {
    const r = assessDevPortalWorkspace("", ioFromMap(new Map()));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "missing-root");
  });

  it("fails when root path does not exist (worktree removed)", () => {
    const r = assessDevPortalWorkspace("/gone/worktree", ioFromMap(new Map()));
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, "root-missing");
      assert.match(r.detail, /removed|exist/i);
    }
  });

  it("fails when package.json is missing (empty bind mount)", () => {
    const map = new Map([
      ["/workspace", { type: "dir" }],
    ]);
    // force root exists as dir
    const io = {
      existsSync: (p) => p === "/workspace",
      statSync: (p) => {
        if (p === "/workspace") return { isDirectory: () => true };
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
      readFileSync: () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    };
    const r = assessDevPortalWorkspace("/workspace", io);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "package-json-missing");
  });

  it("fails when apps/web/package.json is missing", () => {
    const root = "/workspace";
    const map = new Map([
      [`${root}/package.json`, { type: "file", body: JSON.stringify({ name: "dpf" }) }],
    ]);
    const io = {
      existsSync: (p) => map.has(p),
      statSync: (p) => {
        if (p === root) return { isDirectory: () => true };
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
      readFileSync: (p) => map.get(p).body,
    };
    const r = assessDevPortalWorkspace(root, io);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "web-package-missing");
  });

  it("passes for a full DPF monorepo layout", () => {
    const root = "/workspace";
    const map = new Map([
      [`${root}/package.json`, { type: "file", body: JSON.stringify({ name: "dpf", private: true }) }],
      [`${root}/apps/web/package.json`, { type: "file", body: JSON.stringify({ name: "web" }) }],
    ]);
    const io = {
      existsSync: (p) => map.has(p),
      statSync: (p) => {
        if (p === root) return { isDirectory: () => true };
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
      readFileSync: (p) => map.get(p).body,
    };
    const r = assessDevPortalWorkspace(root, io);
    assert.equal(r.ok, true);
  });
});

describe("preflightExitCode / formatPreflightFailure", () => {
  it("uses exit 0 on failure so Docker does not restart-loop", () => {
    const fail = /** @type {const} */ ({
      ok: false,
      reason: "package-json-missing",
      detail: "gone",
    });
    assert.equal(preflightExitCode(fail), 0);
    assert.equal(preflightExitCode({ ok: true }), 0);
  });

  it("formats a clear BI-tagged failure banner", () => {
    const msg = formatPreflightFailure({
      ok: false,
      reason: "root-missing",
      detail: "worktree deleted",
    });
    assert.match(msg, /BI-0DF1F354/);
    assert.match(msg, /crash-loop/i);
    assert.match(msg, /worktree deleted/);
  });
});
