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

  it("rendezvous with the same-run build without serializing fixture setup", () => {
    assert.match(
      ci,
      /ux-route-sweep-runtime:[\s\S]*?needs: \[changes, exact-tree-evidence-shadow\]/,
    );
    assert.doesNotMatch(ci, /ux-route-sweep-runtime:[\s\S]*?needs: \[changes, build\]/);
    assert.match(ci, /uses: \.\/\.github\/workflows\/ux-route-sweep\.yml/);
    assert.match(
      ci,
      /reuse_current_run_build: \$\{\{ needs\.changes\.outputs\.heavy == 'true' \}\}/,
    );
    assert.match(ux, /workflow_call:/);
    assert.doesNotMatch(ux, /^\s{2}pull_request:/m);
    assert.doesNotMatch(ux, /^\s{2}merge_group:/m);
    assert.doesNotMatch(ux, /node scripts\/ci-build-artifact\.mjs locate/);
    assert.match(ux, /node scripts\/ci-build-artifact\.mjs await-current-run/);
    assert.match(
      ux,
      /--artifact-name web-production-build-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/,
    );
    assert.match(ux, /--producer-job-name "Production Build"/);
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
    assert.ok(
      ux.indexOf("Install Playwright Chromium") < ux.indexOf("Await current-run production build"),
      "browser setup should overlap the producer build",
    );
  });

  it("preserves the stable required check and manual calibration path", () => {
    assert.match(
      ci,
      /ux-route-sweep:\s*\n\s+name: UX Route Budget Sweep\s*\n\s+runs-on: ubuntu-latest\s*\n\s+if: always\(\)\s*\n\s+needs: \[changes, exact-tree-evidence-shadow, ux-route-sweep-runtime\]/,
    );
    assert.match(ci, /needs\.ux-route-sweep-runtime\.result/);
    assert.match(ci, /merge_group:/);
    assert.match(ux, /workflow_dispatch:/);
    assert.doesNotMatch(ux, /^\s{2}push:/m);
    assert.match(ux, /update_baseline:/);
    assert.match(ux, /--update-baseline/);
  });

  it("skips runner allocation only for non-portal scope or accepted exact-tree reuse", () => {
    assert.match(
      ux,
      /run_sweep:\s*\n\s+description:[^\n]*\n\s+required: false\s*\n\s+type: boolean\s*\n\s+default: true/,
    );
    assert.match(
      ux,
      /sweep:\s*\n\s+name: UX Route Sweep Runtime[\s\S]*?if: \$\{\{ github\.event_name == 'workflow_dispatch' \|\| inputs\.run_sweep == true \}\}\s*\n\s+runs-on:/,
    );
    assert.match(
      ci,
      /run_sweep: \$\{\{ needs\.changes\.outputs\.portal_ux_required != 'false' \}\}/,
      "only the planner's exact non-portal signal may suppress exhaustive UX evidence",
    );
    assert.match(
      ci,
      /ux-route-sweep:\s*\n\s+name: UX Route Budget Sweep[\s\S]*?needs: \[changes, exact-tree-evidence-shadow, ux-route-sweep-runtime\]/,
    );
    assert.match(
      ci,
      /REUSE_EXACT_TREE: \$\{\{ needs\.exact-tree-evidence-shadow\.outputs\.reusable \}\}/,
    );
    assert.match(
      ci,
      /if \[ "\$REUSE_EXACT_TREE" = "true" \]; then[\s\S]*?\[ "\$RUNTIME_RESULT" != "skipped" \][\s\S]*?exit 1[\s\S]*?exit 0/,
      "the aggregate must accept a runtime skip only after an exact reusable verdict",
    );
    assert.match(
      ci,
      /PORTAL_UX_REQUIRED: \$\{\{ needs\.changes\.outputs\.portal_ux_required \}\}/,
    );
    assert.match(
      ci,
      /if \[ "\$PORTAL_UX_REQUIRED" = "false" \]; then[\s\S]*?\[ "\$RUNTIME_RESULT" != "skipped" \][\s\S]*?exit 1[\s\S]*?exit 0/,
      "the stable aggregate must accept a skip only for the authoritative non-portal scope",
    );
    assert.match(
      ci,
      /if \[ "\$RUNTIME_RESULT" != "success" \]; then[\s\S]*?exit 1/,
      "all non-docs and unknown scopes must fail closed unless the sweep succeeds",
    );
  });

  it("keeps branch-protection required contexts reporting on exact-tree reuse (BI-DAF33DF3)", () => {
    const mergeJob = ci.match(/merge-readiness:[\s\S]*?(?=\n  [a-z0-9-]+:|\n*$)/)?.[0] || "";
    assert.match(mergeJob, /name: Merge Readiness/);
    assert.match(mergeJob, /if: always\(\)/);
    assert.doesNotMatch(
      mergeJob,
      /reusable != 'true'/,
      "Merge Readiness must still report when exact-tree reuse skips heavy jobs",
    );
    const uxJob = ci.match(/ux-route-sweep:\s*\n\s+name: UX Route Budget Sweep[\s\S]*?(?=\n  [a-z0-9-]+:|\n*$)/)?.[0] || "";
    assert.match(uxJob, /if: always\(\)/);
    assert.doesNotMatch(
      uxJob,
      /reusable != 'true'/,
      "UX Route Budget Sweep must still report on the reuse path",
    );
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
