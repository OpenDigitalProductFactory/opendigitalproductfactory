// A reaper that cannot ask who is working must not decide that nobody is.
//
// These pin the two properties that failed on 2026-09-02, when 132 worktrees
// were classified reapable and 24 of them belonged to active Workrooms: the
// claim record must be consulted, and an unreadable claim record must fail SAFE.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseActiveWorktreePaths,
  loadActiveWorkroomPaths,
  pathHasActiveClaim,
  normalizePath,
  ACTIVE_WORKROOM_STATUSES,
} from "./worktree-liveness.mjs";

const roomsPayload = (rooms) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text: JSON.stringify({ workrooms: rooms }) }] },
  });

describe("parseActiveWorktreePaths", () => {
  it("collects worktrees of rooms that still own their work", () => {
    const { available, activePaths } = parseActiveWorktreePaths(
      roomsPayload([
        { capsuleId: "WC-1", status: "working", worktreePath: "D:/wt/alpha" },
        { capsuleId: "WC-2", status: "ready", worktreePath: "D:/wt/beta" },
      ]),
    );
    assert.equal(available, true);
    assert.equal(activePaths.size, 2);
    assert.ok(activePaths.has(normalizePath("D:/wt/alpha")));
  });

  it("ignores rooms in a terminal state", () => {
    const { activePaths } = parseActiveWorktreePaths(
      roomsPayload([
        { capsuleId: "WC-3", status: "abandoned", worktreePath: "D:/wt/gone" },
        { capsuleId: "WC-4", status: "complete", worktreePath: "D:/wt/done" },
        { capsuleId: "WC-5", status: "archived", worktreePath: "D:/wt/old" },
      ]),
    );
    assert.equal(activePaths.size, 0);
  });

  it("treats blocked and ready-for-review as still owned", () => {
    // A blocked room is waiting on something, not finished — reaping its tree
    // strands the very work that is waiting.
    for (const status of ["blocked", "ready-for-review", "ready-for-promotion", "verifying"]) {
      assert.ok(ACTIVE_WORKROOM_STATUSES.includes(status), `${status} must count as active`);
    }
  });

  it("reads an SSE-wrapped response", () => {
    const sse = `event: message\ndata: ${roomsPayload([
      { capsuleId: "WC-6", status: "working", worktreePath: "D:/wt/sse" },
    ])}\n\n`;
    const { available, activePaths } = parseActiveWorktreePaths(sse);
    assert.equal(available, true);
    assert.ok(activePaths.has(normalizePath("D:/wt/sse")));
  });

  it("matches regardless of separator or case", () => {
    const { activePaths } = parseActiveWorktreePaths(
      roomsPayload([{ capsuleId: "WC-7", status: "working", worktreePath: "D:\\WT\\Mixed\\" }]),
    );
    assert.ok(pathHasActiveClaim(activePaths, "D:/wt/mixed"));
  });

  it("reports UNAVAILABLE on an empty or unparseable response", () => {
    for (const bad of ["", "   ", "not json", undefined]) {
      const { available } = parseActiveWorktreePaths(bad);
      assert.equal(available, false, `${JSON.stringify(bad)} must not read as available`);
    }
  });

  it("reports UNAVAILABLE when the response carries no workroom list", () => {
    const { available } = parseActiveWorktreePaths(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [] } }),
    );
    assert.equal(available, false);
  });
});

describe("loadActiveWorkroomPaths — fail safe, never fail open", () => {
  it("is UNAVAILABLE without a token, rather than an empty success", () => {
    // The lease loader returns "" here, which reads downstream as "nothing is
    // leased" and protects nothing. This must not repeat that.
    const result = loadActiveWorkroomPaths({ env: {}, run: () => { throw new Error("unused"); } });
    assert.equal(result.available, false);
    assert.match(result.reason, /token/i);
  });

  it("is UNAVAILABLE when the query fails", () => {
    const result = loadActiveWorkroomPaths({
      env: { DPF_MCP_BEARER_TOKEN: "t" },
      run: () => ({ status: 7, stdout: "", stderr: "connection refused" }),
    });
    assert.equal(result.available, false);
  });

  it("is UNAVAILABLE when the runner throws", () => {
    const result = loadActiveWorkroomPaths({
      env: { DPF_MCP_BEARER_TOKEN: "t" },
      run: () => { throw new Error("curl missing"); },
    });
    assert.equal(result.available, false);
    assert.match(result.reason, /curl missing/);
  });

  it("is AVAILABLE and returns claims on success", () => {
    const result = loadActiveWorkroomPaths({
      env: { DPF_MCP_BEARER_TOKEN: "t" },
      run: () => ({
        status: 0,
        stdout: roomsPayload([{ capsuleId: "WC-8", status: "working", worktreePath: "D:/wt/live" }]),
      }),
    });
    assert.equal(result.available, true);
    assert.ok(pathHasActiveClaim(result.activePaths, "D:/wt/live"));
  });
});

describe("pathHasActiveClaim", () => {
  it("is false for an empty or absent claim set rather than throwing", () => {
    assert.equal(pathHasActiveClaim(new Set(), "D:/wt/a"), false);
    assert.equal(pathHasActiveClaim(undefined, "D:/wt/a"), false);
  });
});
