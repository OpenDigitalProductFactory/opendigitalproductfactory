import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(".github/workflows/publish-image.yml", "utf8");

function jobBlock(jobName, nextJobName) {
  const start = workflow.indexOf(`  ${jobName}:`);
  assert.notEqual(start, -1, `missing workflow job: ${jobName}`);

  const next = workflow.indexOf(`\n  ${nextJobName}:`, start + 1);
  assert.notEqual(next, -1, `missing workflow job after ${jobName}: ${nextJobName}`);
  return workflow.slice(start, next);
}

test("published image identity uses the resolved immutable release tag", () => {
  const build = jobBlock("build", "merge");

  assert.match(build, /DPF_PLATFORM_VERSION=\$\{\{ needs\.gate\.outputs\.tag \}\}/);
  assert.match(build, /org\.opencontainers\.image\.version=\$\{\{ needs\.gate\.outputs\.tag \}\}/);
  assert.doesNotMatch(build, /github\.ref_name/);
});

test("published promoter identity is bound to its checked-out contract", () => {
  const build = jobBlock("build", "merge");

  assert.match(build, /id: promoter-contract/);
  assert.match(
    build,
    /sha256sum promoter-contract\.json[^\n]*GITHUB_OUTPUT/,
    "the release workflow must derive the digest from the contract in the release commit",
  );
  assert.match(
    build,
    /DPF_PROMOTER_CONTRACT_DIGEST=sha256:\$\{\{ steps\.promoter-contract\.outputs\.digest \}\}/,
    "the promoter Dockerfile must receive the derived contract digest instead of its 'unknown' default",
  );
});

test("latest is promoted only from the verified immutable release tag", () => {
  const promotion = workflow.slice(workflow.indexOf("  promote-latest:"));

  assert.match(promotion, /needs: \[verify, gate\]/);
  assert.match(promotion, /TAG: \$\{\{ needs\.gate\.outputs\.tag \}\}/);
  assert.match(promotion, /imagetools create --tag "\$\{IMAGE\}:latest" "\$\{IMAGE\}:\$\{TAG\}"/);
});
