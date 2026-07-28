import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const ux = readFileSync(".github/workflows/ux-route-sweep.yml", "utf8");

describe("production-build artifact workflow wiring", () => {
  it("publishes one checksummed exact-tree build after Production Build", () => {
    assert.match(ci, /node scripts\/ci-build-artifact\.mjs create/);
    assert.match(ci, /name: web-production-build-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
    assert.match(ci, /retention-days: 1/);
    assert.match(ci, /id: package-build[\s\S]*?continue-on-error: true/);
    assert.match(ci, /steps\.package-build\.outcome == 'success'/);
  });

  it("reuses only PR and merge-group artifacts and retains a fail-safe build", () => {
    assert.match(ux, /github\.event_name == 'pull_request' \|\| github\.event_name == 'merge_group'/);
    assert.match(ux, /node scripts\/ci-build-artifact\.mjs locate/);
    assert.match(ux, /DPF_CI_RUN_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
    assert.match(ux, /--wait-seconds 600/);
    assert.match(ux, /uses: actions\/download-artifact@v8/);
    assert.match(ux, /node scripts\/ci-build-artifact\.mjs consume/);
    assert.match(ux, /if: steps\.materialize-build\.outputs\.reused != 'true'/);
    assert.match(ux, /run: pnpm --filter web build/);
  });

  it("grants only read access to workflow artifacts", () => {
    assert.match(ux, /permissions:[\s\S]*?actions: read[\s\S]*?contents: read/);
    assert.doesNotMatch(ux, /actions: write/);
  });
});
