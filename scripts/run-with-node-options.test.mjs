import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

describe("run-with-node-options", () => {
  it("preserves existing NODE_OPTIONS while adding the requested options", () => {
    const result = spawnSync(process.execPath, [
      "scripts/run-with-node-options.mjs",
      "--max-old-space-size=8192",
      "--",
      "node",
      "scripts/test-fixtures/assert-node-options.mjs",
    ], {
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_OPTIONS: "--trace-warnings",
      },
    });

    assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
  });
});
