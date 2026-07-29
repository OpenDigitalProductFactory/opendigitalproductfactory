import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const ux = readFileSync(".github/workflows/ux-route-sweep.yml", "utf8");
const artifactScript = readFileSync("scripts/ci-build-artifact.mjs", "utf8");

describe("production-build artifact workflow wiring", () => {
  it("publishes one checksummed exact-tree build after Production Build", () => {
    assert.match(ci, /node scripts\/ci-build-artifact\.mjs create/);
    assert.match(artifactScript, /"\.next\/standalone",\s*"\.next\/static"/);
    assert.match(artifactScript, /apps\/web\/\.next\/standalone\/version\.json/);
    assert.match(ci, /name: web-production-build-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
    assert.match(ci, /retention-days: 1/);
    assert.match(ci, /id: package-build[\s\S]*?continue-on-error: true/);
    assert.match(ci, /steps\.package-build\.outcome == 'success'/);
  });

  it("hands PR and merge-group builds to UX through a same-run dependency", () => {
    assert.match(ci, /ux-route-sweep-runtime:[\s\S]*?needs: \[changes, build\]/);
    assert.match(ci, /uses: \.\/\.github\/workflows\/ux-route-sweep\.yml/);
    assert.match(
      ci,
      /reuse_current_run_build: \$\{\{ needs\.changes\.outputs\.heavy == 'true' \}\}/,
    );
    assert.match(ux, /workflow_call:/);
    assert.doesNotMatch(ux, /^\s{2}pull_request:/m);
    assert.doesNotMatch(ux, /^\s{2}merge_group:/m);
    assert.doesNotMatch(ux, /node scripts\/ci-build-artifact\.mjs locate/);
    assert.doesNotMatch(ux, /--wait-seconds 600/);
    assert.match(ux, /uses: actions\/download-artifact@v8/);
    assert.match(
      ux,
      /name: web-production-build-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/,
    );
    assert.doesNotMatch(ux, /github-token:/);
    assert.doesNotMatch(ux, /run-id:/);
    assert.match(ux, /node scripts\/ci-build-artifact\.mjs consume/);
    assert.match(ux, /--source-run-id "\$\{\{ github\.run_id \}\}"/);
    assert.match(ux, /if: steps\.materialize-build\.outputs\.reused != 'true'/);
    assert.match(ux, /run: pnpm --filter web build/);
    assert.match(ux, /DPF_REUSED_BUILD: \$\{\{ steps\.materialize-build\.outputs\.reused \}\}/);
    assert.match(ux, /cd apps\/web\/\.next\/standalone[\s\S]*?node apps\/web\/server\.js/);
  });

  it("preserves the stable required check and manual calibration path", () => {
    assert.match(
      ci,
      /ux-route-sweep:\s*\n\s+name: UX Route Budget Sweep\s*\n\s+runs-on: ubuntu-latest\s*\n\s+if: always\(\)\s*\n\s+needs: ux-route-sweep-runtime/,
    );
    assert.match(ci, /needs\.ux-route-sweep-runtime\.result/);
    assert.match(ci, /merge_group:/);
    assert.match(ux, /workflow_dispatch:/);
    assert.doesNotMatch(ux, /^\s{2}push:/m);
    assert.match(ux, /update_baseline:/);
    assert.match(ux, /--update-baseline/);
  });

  it("grants only read access to workflow artifacts", () => {
    assert.match(ci, /permissions:[\s\S]*?actions: read[\s\S]*?contents: read/);
    assert.match(ux, /permissions:[\s\S]*?actions: read[\s\S]*?contents: read/);
    assert.doesNotMatch(ux, /actions: write/);
  });

  it("allows a bounded inventory larger than Node's spawnSync default", () => {
    assert.match(artifactScript, /maxBuffer: 64 \* 1024 \* 1024/);
    assert.match(artifactScript, /if \(result\.error\)/);
  });
});
